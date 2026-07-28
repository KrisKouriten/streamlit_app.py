import { query } from "./db";
import { audit } from "./governance";
import {
  validatePo, canSubmitForSignoff, rechargeAmounts, invoiceOutcome,
  poTransitionError, isEditablePo, headOfficeLine,
} from "./po-rules.js";

/*
 * Purchase Order Tracker — DB layer. A department raises a P.O (header + optional
 * store recharge), and it moves to PENDING_SIGNOFF once complete. Validity, the
 * recharge maths and the state machine live in po-rules.js; this layer is the
 * reads and writes. Degrades to { ready:false } before migration 046 (42P01),
 * and every mutation is audited.
 */

const tableMissing = (e) => e?.code === "42P01";
const actorOf = (a) => a?.email || a?.name || "system";

// Department list for the picker (from the governed dimension). Empty if the
// dimension isn't populated — the UI then allows a free-typed department.
export async function getDepartments() {
  try {
    const { rows } = await query(
      `SELECT department_code, department_name FROM core.dim_department ORDER BY department_name`
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

const HEADER_FIELDS = {
  po_date: "po_date", supplier: "supplier", payment_terms: "payment_terms",
  payment_date: "payment_date", currency: "currency", payment_value: "payment_value",
  po_category: "po_category", xero_po_number: "xero_po_number",
  fulfilment_start_date: "fulfilment_start_date", fulfilment_days: "fulfilment_days",
  department: "department", is_marketing: "is_marketing", marketing_levy: "marketing_levy",
  recharge_enabled: "recharge_enabled", recharge_ho_only: "recharge_ho_only", notes: "notes",
};

// The recharge lines to store for a P.O: a single Head-Office line when HO-only,
// else the user's per-store split (nothing when recharge is off).
function rechargeLinesFor(po) {
  if (!po.recharge_enabled) return [];
  if (po.recharge_ho_only) return [headOfficeLine()];
  return Array.isArray(po.recharge) ? po.recharge : [];
}

function deriveInvoiceAction(po) {
  return invoiceOutcome({
    isMarketing: !!po.is_marketing,
    marketingLevy: po.marketing_levy === undefined ? null : po.marketing_levy,
    rechargeEnabled: !!po.recharge_enabled,
  }).code;
}

export async function createPo(input, actor) {
  const err = validatePo(input);
  if (err) throw new Error(err);
  const invoice_action = deriveInvoiceAction(input);
  const { rows } = await query(
    `INSERT INTO finance.purchase_order
       (po_date, supplier, payment_terms, payment_date, currency, payment_value,
        po_category, xero_po_number, fulfilment_start_date, fulfilment_days, department,
        is_marketing, marketing_levy, recharge_enabled, recharge_ho_only, invoice_action, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'DRAFT',$18)
     RETURNING po_id`,
    [input.po_date || null, input.supplier.trim(), input.payment_terms || null, input.payment_date || null,
     input.currency || "GBP", Number(input.payment_value),
     input.po_category, input.xero_po_number.trim(), input.fulfilment_start_date || null,
     input.fulfilment_days != null && input.fulfilment_days !== "" ? Number(input.fulfilment_days) : null,
     input.department.trim(), !!input.is_marketing, input.is_marketing ? (input.marketing_levy ?? null) : null,
     !!input.recharge_enabled, !!input.recharge_ho_only, invoice_action, input.notes || null, actorOf(actor)]
  );
  const poId = rows[0].po_id;
  const lines = rechargeLinesFor(input);
  if (lines.length) await replaceRecharge(poId, lines, Number(input.payment_value));
  await audit({ actor, eventType: "purchase_order.create", objectType: "purchase_order", objectRef: String(poId), detail: { supplier: input.supplier, value: input.payment_value, department: input.department } });
  return { poId };
}

async function replaceRecharge(poId, lines, totalValue) {
  await query(`DELETE FROM finance.purchase_order_recharge WHERE po_id = $1`, [poId]);
  const withAmounts = rechargeAmounts(lines, totalValue);
  for (const l of withAmounts) {
    await query(
      `INSERT INTO finance.purchase_order_recharge (po_id, store_code, store_name, pct, amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [poId, l.store_code || null, l.store_name || null, Number(l.pct) || 0, Number(l.amount) || 0]
    );
  }
}

async function requireEditable(poId) {
  const { rows } = await query(`SELECT status FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  if (!rows.length) throw new Error("P.O not found");
  if (!isEditablePo(rows[0].status)) throw new Error(`This P.O is ${rows[0].status.replace(/_/g, " ").toLowerCase()} and cannot be edited`);
  return rows[0].status;
}

export async function updatePo(poId, patch = {}, actor) {
  await requireEditable(poId);
  // Load current, merge, re-validate, recompute invoice action.
  const current = await getPo(poId);
  const merged = { ...current.po, ...patch };
  const err = validatePo(merged);
  if (err) throw new Error(err);

  const sets = [], vals = [];
  let i = 1;
  for (const [k, col] of Object.entries(HEADER_FIELDS)) {
    if (k in patch) { sets.push(`${col} = $${i++}`); vals.push(patch[k] === "" ? null : patch[k]); }
  }
  sets.push(`invoice_action = $${i++}`); vals.push(deriveInvoiceAction(merged));
  vals.push(poId);
  await query(`UPDATE finance.purchase_order SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE po_id = $${i}`, vals);

  if ("recharge" in patch || "recharge_ho_only" in patch || "recharge_enabled" in patch) {
    await replaceRecharge(poId, rechargeLinesFor(merged), Number(merged.payment_value));
  }
  await audit({ actor, eventType: "purchase_order.update", objectType: "purchase_order", objectRef: String(poId), detail: { fields: Object.keys(patch) } });
  return { ok: true };
}

export async function getPo(poId) {
  try {
    const { rows } = await query(`SELECT * FROM finance.purchase_order WHERE po_id = $1`, [poId]);
    const po = rows[0] || null;
    if (!po) return null;
    const { rows: recharge } = await query(
      `SELECT recharge_id, store_code, store_name, pct, amount FROM finance.purchase_order_recharge WHERE po_id = $1 ORDER BY store_name`, [poId]);
    return { po, recharge };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

export async function listPos({ owner = null, status = null, department = null, limit = 100 } = {}) {
  try {
    const { rows } = await query(
      `SELECT po_id, po_date, supplier, currency, payment_value, po_category, xero_po_number,
              department, is_marketing, marketing_levy, recharge_enabled, invoice_action,
              status, created_by, created_at, updated_at
       FROM finance.purchase_order
       WHERE ($1::varchar IS NULL OR created_by = $1)
         AND ($2::varchar IS NULL OR status = $2)
         AND ($3::varchar IS NULL OR department = $3)
       ORDER BY created_at DESC LIMIT $4`,
      [owner, status, department, limit]
    );
    return { ready: true, pos: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, pos: [] };
    throw e;
  }
}

// Move a completed P.O to department-head sign-off. Enforces the full gate
// (fields, marketing-levy answer, 100% recharge).
export async function submitForSignoff(poId, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  const tErr = poTransitionError("submit_for_signoff", loaded.po.status);
  if (tErr) throw new Error(tErr);
  const gate = canSubmitForSignoff(loaded.po, loaded.recharge);
  if (gate) throw new Error(gate);
  await query(`UPDATE finance.purchase_order SET status = 'PENDING_SIGNOFF', updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`, [poId]);
  await audit({ actor, eventType: "purchase_order.submit_for_signoff", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true, status: "PENDING_SIGNOFF" };
}

// Return a P.O awaiting sign-off back to draft for edits.
export async function returnToDraft(poId, actor) {
  const { rows } = await query(`SELECT status FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  if (!rows.length) throw new Error("P.O not found");
  const tErr = poTransitionError("return_to_draft", rows[0].status);
  if (tErr) throw new Error(tErr);
  await query(`UPDATE finance.purchase_order SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`, [poId]);
  await audit({ actor, eventType: "purchase_order.return_to_draft", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true, status: "DRAFT" };
}
