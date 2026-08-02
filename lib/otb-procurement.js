/*
 * Merchandising procurement requests — DB layer (migration 066). The Procurement
 * Tracker becomes the merchandising purchasing workflow, controlled by an approved
 * Open-to-Buy plan: every request identifies a channel + OTB version/period, is
 * validated against the remaining OTB, and — once approved — creates a commitment
 * and can generate a formal P.O without rekeying. Degrades pre-migration.
 */

import { query } from "./db";
import { audit } from "./governance";
import { availableOtb, getOtbVersion } from "./otb.js";
import { createPo } from "./purchase-orders.js";
import { validateAgainstOtb, landedCost, OTB_CHANNELS } from "./otb-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "42703" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const sourceFor = (channel) => (channel === "MINISO_MDS" ? "MINISO" : "LOCAL");

export const MERCH_REQUEST_FLOW = [
  "DRAFT", "MERCH_REVIEW", "OTB_VALIDATED", "FINANCE_REVIEW", "APPROVED",
  "ORDERED", "SHIPPED", "IN_TRANSIT", "RECEIVED", "ALLOCATED", "CLOSED",
];

const REQUEST_COLS = `purchase_id, channel_code, otb_version_id, otb_period, request_status, supplier,
  category, sku_or_range, units, currency, fx_rate, amount_gbp, freight, duty, landed_cost, request_date,
  expected_order_date, expected_shipment_date, expected_receipt_date, expected_availability_date,
  linked_store, new_store_flag, bau_flag, clearance_replacement_flag, reason, po_id, validation_status,
  exception_by, exception_reason, exception_at, created_by`;

export async function listMerchRequests({ otbVersionId = null, channel = null, status = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT ${REQUEST_COLS} FROM finance.procurement_purchase
        WHERE channel_code IS NOT NULL
          AND ($1::bigint IS NULL OR otb_version_id = $1)
          AND ($2::varchar IS NULL OR channel_code = $2)
          AND ($3::varchar IS NULL OR request_status = $3)
        ORDER BY request_date DESC NULLS LAST, purchase_id DESC`,
      [otbVersionId, channel, status]);
    return rows;
  } catch (e) {
    if (absent(e)) return [];
    throw e;
  }
}

// The available-OTB view for a request being drafted: approved OTB, commitments,
// remaining before + after this request, and the validation status.
export async function requestAvailability({ otbVersionId, channel, period, requestValue }) {
  const version = await getOtbVersion(otbVersionId);
  const hasApprovedOtb = !!version && ["APPROVED", "LOCKED"].includes(version.status);
  const avail = await availableOtb({ versionId: otbVersionId, channel, period });
  const validation = validateAgainstOtb({ requestValue, remainingBefore: avail.remaining, hasApprovedOtb });
  return { ...avail, ...validation, hasApprovedOtb, versionStatus: version?.status || null };
}

export async function createMerchRequest(input, actor) {
  if (!OTB_CHANNELS.includes(input.channel_code)) throw new Error("Choose a purchase channel (Miniso MDS or Local Purchase)");
  if (!input.supplier || !String(input.supplier).trim()) throw new Error("Enter the supplier");
  const value = Number(input.amount_gbp) || 0;
  if (!(value > 0)) throw new Error("Enter a purchase value greater than zero");
  const landed = landedCost({ purchaseValue: value, freight: input.freight, duty: input.duty, fxRate: input.fx_rate || 1 });

  let validation_status = null;
  if (input.otb_version_id) {
    const a = await requestAvailability({ otbVersionId: input.otb_version_id, channel: input.channel_code, period: input.otb_period, requestValue: value });
    validation_status = a.status;
  }
  const orderYm = input.otb_period || (input.request_date ? String(input.request_date).slice(0, 7) : null);
  const { rows } = await query(
    `INSERT INTO finance.procurement_purchase
       (source, channel_code, otb_version_id, otb_period, request_status, supplier, category, sku_or_range,
        units, currency, fx_rate, order_ym, amount_gbp, freight, duty, landed_cost, terms_days, status,
        request_date, expected_order_date, expected_shipment_date, expected_receipt_date, expected_availability_date,
        linked_store, new_store_flag, bau_flag, clearance_replacement_flag, reason, validation_status, source_tag, created_by)
     VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'COMMITTED',$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'MERCH_REQUEST',$28)
     RETURNING purchase_id`,
    [sourceFor(input.channel_code), input.channel_code, input.otb_version_id || null, input.otb_period || null,
     input.supplier.trim(), input.category || null, input.sku_or_range || null, input.units == null ? null : Number(input.units),
     input.currency || "GBP", input.fx_rate == null ? null : Number(input.fx_rate), orderYm, value,
     input.freight == null ? null : Number(input.freight), input.duty == null ? null : Number(input.duty), landed,
     input.terms_days == null ? null : Number(input.terms_days), input.request_date || null, input.expected_order_date || null,
     input.expected_shipment_date || null, input.expected_receipt_date || null, input.expected_availability_date || null,
     input.linked_store || null, input.new_store_flag === true, input.bau_flag !== false, input.clearance_replacement_flag === true,
     input.reason || null, validation_status, actorOf(actor)]);
  await audit({ actor, eventType: "merch_request.create", objectType: "procurement_purchase", objectRef: String(rows[0].purchase_id), detail: { channel: input.channel_code, value, validation_status } });
  return { ok: true, purchaseId: rows[0].purchase_id, validationStatus: validation_status };
}

// Move a request through its lifecycle. Approving records an OTB commitment
// (APPROVED_REQUEST) that consumes the channel's remaining OTB on the next compute.
export async function transitionMerchRequest(id, action, actor) {
  const { rows } = await query(`SELECT ${REQUEST_COLS} FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  const req = rows[0];
  if (!req) throw new Error("Request not found");
  const to = {
    submit: "MERCH_REVIEW", validate: "OTB_VALIDATED", finance: "FINANCE_REVIEW", approve: "APPROVED",
    reject: "REJECTED", order: "ORDERED", ship: "SHIPPED", transit: "IN_TRANSIT", receive: "RECEIVED",
    allocate: "ALLOCATED", close: "CLOSED",
  }[action];
  if (!to) throw new Error(`Unknown action '${action}'`);

  // A request that exceeds OTB cannot be approved without an authorised exception.
  if (action === "approve" && req.validation_status === "EXCEEDS_OTB" && !req.exception_at) {
    throw new Error("This request exceeds OTB — reduce it, move period, revise OTB, or record an authorised exception first");
  }
  await query(`UPDATE finance.procurement_purchase SET request_status = $2 WHERE purchase_id = $1`, [id, to]);
  if (to === "APPROVED" && req.otb_version_id) {
    await query(
      `INSERT INTO merch.otb_commitment (otb_version_id, channel_code, period, kind, amount, reference, source)
       VALUES ($1,$2,$3,'APPROVED_REQUEST',$4,$5,'PROCUREMENT')`,
      [req.otb_version_id, req.channel_code, req.otb_period || "ALL", Number(req.amount_gbp) || 0, `REQ-${id}`]).catch(() => {});
  }
  await audit({ actor, eventType: `merch_request.${action}`, objectType: "procurement_purchase", objectRef: String(id), detail: { to } });
  return { ok: true, status: to };
}

// Record an authorised exception for a request that exceeds OTB.
export async function setRequestException(id, { reason }, actor) {
  if (!reason || !String(reason).trim()) throw new Error("An exception reason is required");
  await query(
    `UPDATE finance.procurement_purchase
       SET validation_status = 'APPROVED_EXCEPTION', exception_by = $2, exception_reason = $3, exception_at = CURRENT_TIMESTAMP
     WHERE purchase_id = $1`, [id, actorOf(actor), String(reason).trim()]);
  await audit({ actor, eventType: "merch_request.exception", objectType: "procurement_purchase", objectRef: String(id), detail: { reason: String(reason).trim() } });
  return { ok: true };
}

// Controlled OTB transfer between channels — records the transfer and its impacts.
export async function requestChannelTransfer(input, actor) {
  if (input.from_channel === input.to_channel) throw new Error("Choose two different channels");
  await query(
    `INSERT INTO merch.otb_transfer (otb_version_id, from_channel, to_channel, period, amount, reason, sales_mix_impact, margin_impact, cash_impact, requested_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED')`,
    [input.otb_version_id, input.from_channel, input.to_channel, input.period, Number(input.amount) || 0,
     input.reason || null, input.sales_mix_impact || null, input.margin_impact || null, input.cash_impact || null, actorOf(actor)]);
  await audit({ actor, eventType: "otb.transfer.request", objectType: "otb_version", objectRef: String(input.otb_version_id), detail: { from: input.from_channel, to: input.to_channel, amount: input.amount } });
  return { ok: true };
}

// Generate a formal P.O from an approved request — inherits channel, supplier,
// value, currency, OTB reference; no duplicate rekeying. Links po_id back.
export async function generatePoFromRequest(id, actor) {
  const { rows } = await query(`SELECT ${REQUEST_COLS} FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  const req = rows[0];
  if (!req) throw new Error("Request not found");
  if (req.request_status !== "APPROVED") throw new Error("Only an approved request can generate a P.O");
  if (req.po_id) throw new Error("A P.O has already been generated for this request");
  const po = await createPo({
    po_date: req.request_date || req.expected_order_date || new Date().toISOString().slice(0, 10),
    supplier: req.supplier, currency: req.currency || "GBP", payment_value: Number(req.amount_gbp) || 0,
    po_category: "Stock / Merchandise", department: "Merchandising",
    notes: `Merch procurement request REQ-${id} · ${req.channel_code}${req.otb_period ? " · OTB " + req.otb_period : ""}`,
    payment_terms: req.terms_days != null ? `${req.terms_days} days` : null,
    fulfilment_start_date: req.expected_receipt_date || null,
  }, actor);
  await query(`UPDATE finance.procurement_purchase SET po_id = $2, request_status = 'ORDERED' WHERE purchase_id = $1`, [id, po.poId]);
  await audit({ actor, eventType: "merch_request.generate_po", objectType: "procurement_purchase", objectRef: String(id), detail: { poId: po.poId, poNumber: po.poNumber } });
  return { ok: true, poId: po.poId, poNumber: po.poNumber };
}
