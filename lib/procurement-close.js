/*
 * Procurement Summary + Close — DB layer (migration 073). The Finance close
 * lifecycle over finance.procurement_purchase, mirroring lib/purchase-orders.js:
 * approve → challenge → invoice/payment → close (+ re-open). Covers both the
 * cash-tracker purchases (Miniso/Local) and the OTB-linked merch requests — one
 * desk over every row. All lifecycle maths is in procurement-close-rules.js.
 * Degrades to { ready:false } before migration 073 is applied.
 */

import { query } from "./db";
import { audit } from "./governance";
import { financeActionError, isProcChallengeReason, isProcPaymentStatus, committedAmount, lineValue, lcActionError, LC_BANK_DEFAULT, reportBasis, reportedGbp, REPORT_RATE_TYPES, dcDrawdown, validateDc } from "./procurement-close-rules.js";
import { getFxRates } from "./fx";
import { findRate } from "./fx-rules.js";
import { supplierMetaByNorm } from "./suppliers";

// Classify a procurement row's reporting group. The supplier master's own
// classification (migration 090/092) wins; otherwise fall back to the row's
// source (MINISO / LOCAL / everything-else → OTHER).
const normNm = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
function classifySource(row, meta) {
  const m = meta?.source_type;
  if (m) return m;
  const s = String(row.source || "").toUpperCase();
  return s === "MINISO" ? "MINISO" : s === "LOCAL" ? "LOCAL" : "OTHER";
}

const absent = (e) => e?.code === "42P01" || e?.code === "42703" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const COLS = `purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference,
  source_tag, channel_code, otb_version_id, otb_period, request_status, sku_or_range, units, landed_cost,
  po_id, validation_status, finance_status, approved_by, approved_at, invoice_number, invoice_amount,
  challenge_reasons, challenge_note, challenged_by, challenged_at, closed_by, closed_at, payment_status, paid_date,
  lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date, lc_settled, lc_settled_date, lc_settled_amount,
  created_by, created_at`;
// FX columns (migration 085) — the order currency, the actual-cost cashflow rate
// and the costing valuation booked to stock. Appended when present; the close
// desk degrades to the base columns before 085 is run.
const COLS_FX = `${COLS}, currency, amount_ccy, cost_rate_type, cost_fx_rate, stock_rate_type, stock_fx_rate, stock_value_gbp`;
const COLS_FXR = `${COLS_FX}, report_rate_type`; // + FX reporting basis (migration 091)

// Attach the reported GBP (order-currency amount at the row's SPOT/HEDGED basis)
// to each row. Non-foreign rows report their GBP value; foreign rows convert at
// the chosen basis rate. Independent of the cash-cost / costing-FX figures.
function attachReportGbp(rows, rates) {
  for (const r of rows) {
    r.report_rate_type = reportBasis(r);
    const rate = findRate(rates, r.currency, r.report_rate_type);
    r.report_gbp = reportedGbp(r, rate);
  }
  return rows;
}

export async function listForClose({ source = null, financeStatus = null, limit = 500 } = {}) {
  const where = `WHERE ($1::varchar IS NULL OR source = $1) AND ($2::varchar IS NULL OR finance_status = $2)
        ORDER BY (finance_status = 'CLOSED'), created_at DESC LIMIT $3`;
  const params = [source, financeStatus, limit];
  try {
    let rows;
    try {
      ({ rows } = await query(`SELECT ${COLS_FXR} FROM finance.procurement_purchase ${where}`, params));
    } catch (e1) {
      if (!columnMissing(e1)) throw e1;           // pre-091: no report_rate_type
      try {
        ({ rows } = await query(`SELECT ${COLS_FX} FROM finance.procurement_purchase ${where}`, params));
      } catch (e2) {
        if (!columnMissing(e2)) throw e2;         // pre-085: no FX columns
        ({ rows } = await query(`SELECT ${COLS} FROM finance.procurement_purchase ${where}`, params));
      }
    }
    attachReportGbp(rows, await getFxRates().catch(() => []));
    await attachLcs(rows);
    return { ready: true, rows };
  } catch (e) {
    if (absent(e)) return { ready: false, rows: [] };
    throw e;
  }
}

// Attach the LC child rows to each purchase (Miniso multi-LC). Degrades to an
// empty list before migration 083 so the desk still renders.
async function attachLcs(rows) {
  const ids = rows.map((r) => r.purchase_id);
  if (!ids.length) return;
  let lcs = [];
  try { lcs = (await query(`SELECT ${LC_COLS} FROM finance.procurement_lc WHERE purchase_id = ANY($1) ORDER BY created_at, lc_id`, [ids])).rows; }
  catch (e) {
    if (columnMissing(e)) { lcs = (await query(`SELECT ${LC_COLS_LEGACY} FROM finance.procurement_lc WHERE purchase_id = ANY($1) ORDER BY created_at, lc_id`, [ids])).rows; }
    else if (absent(e)) { for (const r of rows) r.lcs = []; return; }
    else throw e;
  }
  const byPid = {};
  for (const l of lcs) (byPid[l.purchase_id] ||= []).push(l);
  for (const r of rows) r.lcs = byPid[r.purchase_id] || [];
  await attachOnFacility(lcs);
  await attachDcs(rows);
}

// Flag each LC with whether its reference is visible on the bank trade facility
// yet (finance.bank_trade_facility, Treasury). l.on_facility is true/false, or
// null when the facility can't be read or the LC has no real reference yet — so
// the desk only shows a "not on facility" warning when it genuinely means the
// bank hasn't reflected the drawing.
const NON_REF = new Set(["", "TBC", "TBA", "PENDING", "N/A", "-"]);
const normRef = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toUpperCase();
async function attachOnFacility(lcs) {
  if (!lcs.length) return;
  let refs = null;
  try {
    const { rows } = await query(`SELECT reference, customer_reference FROM finance.bank_trade_facility`);
    refs = new Set();
    for (const f of rows) { for (const k of [f.reference, f.customer_reference]) { const n = normRef(k); if (n) refs.add(n); } }
  } catch (e) { if (!absent(e)) throw e; refs = null; }   // facility table absent → unknown
  for (const l of lcs) {
    const r = normRef(l.lc_reference);
    l.on_facility = refs == null || NON_REF.has(r) ? null : refs.has(r);
  }
}

// Attach the Documentary Credit records (migration 093) to each purchase and,
// once both DCs and LCs are known, the per-DC drawdown (used vs remaining).
// Degrades to an empty list before migration 093 so the desk still renders.
async function attachDcs(rows) {
  const ids = rows.map((r) => r.purchase_id);
  if (!ids.length) return;
  let dcs = [];
  try { dcs = (await query(`SELECT ${DC_COLS} FROM finance.procurement_dc WHERE purchase_id = ANY($1) ORDER BY created_at, dc_id`, [ids])).rows; }
  catch (e) { if (absent(e)) { for (const r of rows) { r.dcs = []; r.dcDrawdown = dcDrawdown([], r.lcs || []); } return; } throw e; }
  const byPid = {};
  for (const d of dcs) (byPid[d.purchase_id] ||= []).push(d);
  for (const r of rows) {
    r.dcs = byPid[r.purchase_id] || [];
    r.dcDrawdown = dcDrawdown(r.dcs, r.lcs || []);
  }
}

export async function getProcurementLine(id) {
  const { rows } = await query(`SELECT ${COLS} FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  return rows[0] || null;
}

// Set the FX reporting basis (SPOT / HEDGED) for a purchase — reprices only the
// reported GBP on the Procurement / Merchandising views, not the cash cost.
export async function updateReportBasis(id, basis, actor) {
  const b = String(basis || "").toUpperCase();
  if (!REPORT_RATE_TYPES.includes(b)) throw new Error("Reporting basis must be SPOT or HEDGED");
  try {
    await query(`UPDATE finance.procurement_purchase SET report_rate_type = $2 WHERE purchase_id = $1`, [id, b]);
  } catch (e) {
    if (columnMissing(e)) throw new Error("Run migration 091 (procurement report basis) first.");
    throw e;
  }
  await audit({ actor, eventType: "procurement.report_basis.set", objectType: "procurement_purchase", objectRef: String(id), detail: { report_rate_type: b } });
  return { ok: true };
}

async function gate(id, action) {
  const row = await getProcurementLine(id);
  if (!row) throw new Error("Purchase not found");
  const err = financeActionError(action, row);
  if (err) throw new Error(err);
  return row;
}

export async function approveProcurement(id, actor) {
  await gate(id, "approve");
  await query(`UPDATE finance.procurement_purchase SET finance_status='APPROVED', approved_by=$2, approved_at=CURRENT_TIMESTAMP WHERE purchase_id=$1`, [id, actorOf(actor)]);
  await audit({ actor, eventType: "procurement.approve", objectType: "procurement_purchase", objectRef: String(id) });
  return { ok: true, finance_status: "APPROVED" };
}

export async function setInvoice(id, { invoice_number, invoice_amount }, actor) {
  await gate(id, "invoice");
  await query(`UPDATE finance.procurement_purchase SET invoice_number=$2, invoice_amount=$3 WHERE purchase_id=$1`,
    [id, invoice_number || null, invoice_amount == null || invoice_amount === "" ? null : Number(invoice_amount)]);
  await audit({ actor, eventType: "procurement.invoice", objectType: "procurement_purchase", objectRef: String(id) });
  return { ok: true };
}

export async function setPaymentStatus(id, { payment_status, paid_date }, actor) {
  await gate(id, "payment");
  if (!isProcPaymentStatus(payment_status)) throw new Error("Choose a valid payment status");
  // Keep the base status column (COMMITTED/PAID) in step for the cash-tracker view.
  const baseStatus = payment_status === "PAID" ? "PAID" : "COMMITTED";
  await query(`UPDATE finance.procurement_purchase SET payment_status=$2, paid_date=$3, status=$4 WHERE purchase_id=$1`,
    [id, payment_status, payment_status === "PAID" ? (paid_date || null) : null, baseStatus]);
  await audit({ actor, eventType: "procurement.payment", objectType: "procurement_purchase", objectRef: String(id), detail: { payment_status } });
  return { ok: true };
}

export async function challengeProcurement(id, { reasons, note }, actor) {
  await gate(id, "challenge");
  const codes = (reasons || []).filter(isProcChallengeReason);
  if (!codes.length) throw new Error("Pick at least one challenge reason");
  await query(`UPDATE finance.procurement_purchase SET finance_status='CHALLENGED', challenge_reasons=$2, challenge_note=$3, challenged_by=$4, challenged_at=CURRENT_TIMESTAMP WHERE purchase_id=$1`,
    [id, codes.join(","), note || null, actorOf(actor)]);
  await audit({ actor, eventType: "procurement.challenge", objectType: "procurement_purchase", objectRef: String(id), detail: { reasons: codes } });
  return { ok: true, finance_status: "CHALLENGED" };
}

export async function closeProcurement(id, { invoice_number, invoice_amount }, actor) {
  await gate(id, "close");
  await query(
    `UPDATE finance.procurement_purchase
       SET finance_status='CLOSED', closed_by=$2, closed_at=CURRENT_TIMESTAMP,
           invoice_number=COALESCE($3, invoice_number), invoice_amount=COALESCE($4, invoice_amount),
           challenge_reasons=NULL, challenge_note=NULL
     WHERE purchase_id=$1`,
    [id, actorOf(actor), invoice_number || null, invoice_amount == null || invoice_amount === "" ? null : Number(invoice_amount)]);
  await audit({ actor, eventType: "procurement.close", objectType: "procurement_purchase", objectRef: String(id) });
  return { ok: true, finance_status: "CLOSED" };
}

export async function reopenFinance(id, actor) {
  await gate(id, "reopen");
  await query(`UPDATE finance.procurement_purchase SET finance_status='APPROVED', challenge_reasons=NULL, challenge_note=NULL, challenged_by=NULL, challenged_at=NULL, closed_by=NULL, closed_at=NULL WHERE purchase_id=$1`, [id]);
  await audit({ actor, eventType: "procurement.reopen", objectType: "procurement_purchase", objectRef: String(id) });
  return { ok: true, finance_status: "APPROVED" };
}

// ---- Letter-of-Credit settlement (Miniso HQ / HSBC) ----
// Miniso HQ inventory settles by LC, not a supplier invoice. Finance logs the LC once
// it is confirmed, then reconciles the payment once the LC settles. Guarded by
// lcActionError (rules) rather than the invoice/payment gate.
async function lcGate(id, action) {
  const row = await getProcurementLine(id);
  if (!row) throw new Error("Purchase not found");
  const err = lcActionError(action, row);
  if (err) throw new Error(err);
  return row;
}

export async function setLc(id, { lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date }, actor) {
  await lcGate(id, "log-lc");
  if (!lc_reference) throw new Error("Enter the LC reference");
  await query(
    `UPDATE finance.procurement_purchase
       SET lc_reference=$2, lc_amount=$3, lc_bank=$4, lc_confirmed_date=$5, lc_payment_date=$6
     WHERE purchase_id=$1`,
    [id, lc_reference, lc_amount == null || lc_amount === "" ? null : Number(lc_amount),
     lc_bank || LC_BANK_DEFAULT, lc_confirmed_date || null, lc_payment_date || null]);
  await audit({ actor, eventType: "procurement.lc-log", objectType: "procurement_purchase", objectRef: String(id), detail: { lc_reference } });
  return { ok: true };
}

export async function reconcileLc(id, { lc_settled_date, lc_settled_amount }, actor) {
  await lcGate(id, "reconcile-lc");
  // Settlement records the paid date + net and marks the base payment status PAID,
  // keeping the cash-tracker view in step with the invoice/payment flow.
  const settledDate = lc_settled_date || null;
  const settledAmt = lc_settled_amount == null || lc_settled_amount === "" ? null : Number(lc_settled_amount);
  await query(
    `UPDATE finance.procurement_purchase
       SET lc_settled=true, lc_settled_date=$2, lc_settled_amount=$3,
           payment_status='PAID', paid_date=COALESCE($2, paid_date), status='PAID'
     WHERE purchase_id=$1`,
    [id, settledDate, settledAmt]);
  await audit({ actor, eventType: "procurement.lc-reconcile", objectType: "procurement_purchase", objectRef: String(id), detail: { lc_settled_amount: settledAmt } });
  return { ok: true, lc_settled: true };
}

// ---- Multiple LCs per Miniso request (migration 083) ----
// Dates are returned as 'YYYY-MM-DD' strings (not JS Date objects) so they render
// as React children and pre-fill <input type="date"> without a TZ shift.
const LC_COLS = `lc_id, purchase_id, dc_reference, lc_reference, lc_amount, lc_bank,
  to_char(lc_confirmed_date,'YYYY-MM-DD') AS lc_confirmed_date,
  to_char(lc_payment_date,'YYYY-MM-DD') AS lc_payment_date,
  lc_settled, to_char(lc_settled_date,'YYYY-MM-DD') AS lc_settled_date, lc_settled_amount, loan_type,
  to_char(goods_arrived_date,'YYYY-MM-DD') AS goods_arrived_date,
  to_char(actual_payment_date,'YYYY-MM-DD') AS actual_payment_date, created_by, created_at`;
// Pre-084 fallback columns (DC ref / loan / arrival / actual-payment absent).
const LC_COLS_LEGACY = `lc_id, purchase_id, NULL::varchar AS dc_reference, lc_reference, lc_amount, lc_bank,
  to_char(lc_confirmed_date,'YYYY-MM-DD') AS lc_confirmed_date,
  to_char(lc_payment_date,'YYYY-MM-DD') AS lc_payment_date,
  lc_settled, to_char(lc_settled_date,'YYYY-MM-DD') AS lc_settled_date, lc_settled_amount,
  'IMPORT' AS loan_type, NULL::text AS goods_arrived_date, NULL::text AS actual_payment_date, created_by, created_at`;
const columnMissing = (e) => e?.code === "42703";
const numOrNull = (v) => (v == null || v === "" ? null : Number(v));

export async function listLcs(purchaseId) {
  try { const { rows } = await query(`SELECT ${LC_COLS} FROM finance.procurement_lc WHERE purchase_id=$1 ORDER BY created_at, lc_id`, [purchaseId]); return rows; }
  catch (e) {
    if (columnMissing(e)) { const { rows } = await query(`SELECT ${LC_COLS_LEGACY} FROM finance.procurement_lc WHERE purchase_id=$1 ORDER BY created_at, lc_id`, [purchaseId]); return rows; }
    if (absent(e)) return [];
    throw e;
  }
}

// Edit a logged LC — details can change in the weeks before it is used. Also
// records the actual payment date (once drawn / "booked against") and the loan
// type: IMPORT while in transit, TRADE once the goods arrive in Miniso UK's
// possession (goods_arrived_date). Only the provided fields change.
export async function updateLc(lcId, fields = {}, actor) {
  const lc = await lcOwner(lcId);
  if (!lc) throw new Error("LC not found");
  const sets = [], vals = [lcId];
  const put = (col, val) => { sets.push(`${col}=$${vals.length + 1}`); vals.push(val); };
  if ("dc_reference" in fields) put("dc_reference", (fields.dc_reference || "").trim() || null);
  if ("lc_reference" in fields) { const r = String(fields.lc_reference || "").trim(); if (!r) throw new Error("LC reference cannot be empty"); put("lc_reference", r); }
  if ("lc_amount" in fields) put("lc_amount", numOrNull(fields.lc_amount));
  if ("lc_bank" in fields) put("lc_bank", (fields.lc_bank || "").trim() || LC_BANK_DEFAULT);
  if ("lc_confirmed_date" in fields) put("lc_confirmed_date", fields.lc_confirmed_date || null);
  if ("lc_payment_date" in fields) put("lc_payment_date", fields.lc_payment_date || null);
  if ("actual_payment_date" in fields) put("actual_payment_date", fields.actual_payment_date || null);
  if ("goods_arrived_date" in fields) put("goods_arrived_date", fields.goods_arrived_date || null);
  if ("loan_type" in fields) put("loan_type", fields.loan_type === "TRADE" ? "TRADE" : "IMPORT");
  if (!sets.length) return { ok: true };
  try {
    await query(`UPDATE finance.procurement_lc SET ${sets.join(", ")} WHERE lc_id=$1`, vals);
  } catch (e) {
    if (columnMissing(e)) throw new Error("Run migration 084_procurement_lc_loan.sql to record the loan type / actual payment date.");
    throw e;
  }
  await rollupLc(lc.purchase_id, actor);
  await audit({ actor, eventType: "procurement.lc-edit", objectType: "procurement_lc", objectRef: String(lcId), detail: { fields: Object.keys(fields) } });
  return { ok: true };
}

// Recompute the parent's rolled-up lc_* columns from the child LCs — keeps the
// Summary list, CSV export and merch roll-up working while the detail lives in
// the child table. The parent is "settled" only when every LC has settled.
async function rollupLc(purchaseId, actor) {
  const { rows } = await query(`SELECT ${LC_COLS} FROM finance.procurement_lc WHERE purchase_id=$1`, [purchaseId]);
  if (!rows.length) {
    await query(`UPDATE finance.procurement_purchase SET lc_reference=NULL, lc_amount=NULL, lc_confirmed_date=NULL, lc_payment_date=NULL, lc_settled=false, lc_settled_date=NULL, lc_settled_amount=NULL WHERE purchase_id=$1`, [purchaseId]);
    return;
  }
  const refs = rows.map((r) => r.lc_reference).filter(Boolean);
  const reference = refs.length <= 1 ? (refs[0] || null) : `${refs[0]} +${refs.length - 1}`;
  const sum = (k) => { const vs = rows.map((r) => r[k]).filter((v) => v != null); return vs.length ? round2(vs.reduce((s, v) => s + Number(v), 0)) : null; };
  const maxD = (k) => rows.map((r) => r[k]).filter(Boolean).sort().slice(-1)[0] || null;
  const minD = (k) => rows.map((r) => r[k]).filter(Boolean).sort()[0] || null;
  const allSettled = rows.every((r) => r.lc_settled);
  await query(
    `UPDATE finance.procurement_purchase
       SET lc_reference=$2, lc_amount=$3, lc_bank=COALESCE($4, lc_bank), lc_confirmed_date=$5, lc_payment_date=$6,
           lc_settled=$7, lc_settled_date=$8, lc_settled_amount=$9
     WHERE purchase_id=$1`,
    [purchaseId, reference, sum("lc_amount"), rows[0].lc_bank || LC_BANK_DEFAULT, minD("lc_confirmed_date"), maxD("lc_payment_date"),
     allSettled, allSettled ? maxD("lc_settled_date") : null, sum("lc_settled_amount")]);
  // When every LC has settled, mark the purchase paid — mirrors the single-LC flow.
  if (allSettled) {
    await query(`UPDATE finance.procurement_purchase SET payment_status='PAID', status='PAID', paid_date=COALESCE($2, paid_date) WHERE purchase_id=$1`, [purchaseId, maxD("lc_settled_date")]);
  }
}

// Add one LC to a Miniso request (approved, not closed). Multiple are allowed.
export async function addLc(purchaseId, { dc_reference, lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date }, actor) {
  const row = await getProcurementLine(purchaseId);
  if (!row) throw new Error("Purchase not found");
  if (row.source !== "MINISO") throw new Error("Letters of Credit apply to Miniso HQ purchases only");
  if ((row.finance_status || "PENDING") === "PENDING") throw new Error("Approve the purchase before recording an LC");
  if (row.finance_status === "CLOSED") throw new Error("This purchase is closed");
  if (!lc_reference || !String(lc_reference).trim()) throw new Error("Enter the LC reference");
  const dc = (dc_reference || "").trim() || null;
  try {
    await query(
      `INSERT INTO finance.procurement_lc (purchase_id, dc_reference, lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [purchaseId, dc, String(lc_reference).trim(), numOrNull(lc_amount), lc_bank || LC_BANK_DEFAULT, lc_confirmed_date || null, lc_payment_date || null, actorOf(actor)]);
  } catch (e) {
    if (columnMissing(e)) {
      await query(`INSERT INTO finance.procurement_lc (purchase_id, lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [purchaseId, String(lc_reference).trim(), numOrNull(lc_amount), lc_bank || LC_BANK_DEFAULT, lc_confirmed_date || null, lc_payment_date || null, actorOf(actor)]);
    } else throw e;
  }
  await rollupLc(purchaseId, actor);
  await audit({ actor, eventType: "procurement.lc-log", objectType: "procurement_lc", objectRef: String(purchaseId), detail: { lc_reference } });
  return { ok: true };
}

async function lcOwner(lcId) {
  const { rows } = await query(`SELECT lc_id, purchase_id, lc_settled FROM finance.procurement_lc WHERE lc_id=$1`, [lcId]);
  return rows[0] || null;
}

// Reconcile a single LC once it settles.
export async function reconcileLcEntry(lcId, { lc_settled_date, lc_settled_amount }, actor) {
  const lc = await lcOwner(lcId);
  if (!lc) throw new Error("LC not found");
  if (lc.lc_settled) throw new Error("This LC has already been reconciled");
  await query(`UPDATE finance.procurement_lc SET lc_settled=true, lc_settled_date=$2, lc_settled_amount=$3 WHERE lc_id=$1`,
    [lcId, lc_settled_date || null, numOrNull(lc_settled_amount)]);
  await rollupLc(lc.purchase_id, actor);
  await audit({ actor, eventType: "procurement.lc-reconcile", objectType: "procurement_lc", objectRef: String(lcId), detail: { lc_settled_amount: numOrNull(lc_settled_amount) } });
  return { ok: true };
}

// Remove an LC (e.g. logged in error).
export async function deleteLcEntry(lcId, actor) {
  const lc = await lcOwner(lcId);
  if (!lc) throw new Error("LC not found");
  await query(`DELETE FROM finance.procurement_lc WHERE lc_id=$1`, [lcId]);
  await rollupLc(lc.purchase_id, actor);
  await audit({ actor, eventType: "procurement.lc-delete", objectType: "procurement_lc", objectRef: String(lcId), detail: {} });
  return { ok: true };
}

// ---- Documentary Credits (migration 093) ----
// A DC holds the credit value that its LCs draw against. Keyed by reference
// within a request; LCs group under it by dc_reference text.
const DC_COLS = `dc_id, purchase_id, dc_reference, dc_value, currency, notes,
  created_by, to_char(created_at,'YYYY-MM-DD') AS created_at`;
const uniqueViolation = (e) => e?.code === "23505";

export async function listDcs(purchaseId) {
  try { return (await query(`SELECT ${DC_COLS} FROM finance.procurement_dc WHERE purchase_id=$1 ORDER BY created_at, dc_id`, [purchaseId])).rows; }
  catch (e) { if (absent(e)) return []; throw e; }
}

// Add a DC to a Miniso request (approved, not closed).
export async function addDc(purchaseId, input, actor) {
  const row = await getProcurementLine(purchaseId);
  if (!row) throw new Error("Purchase not found");
  if (row.source !== "MINISO") throw new Error("Documentary Credits apply to Miniso HQ purchases only");
  if (row.finance_status === "CLOSED") throw new Error("This purchase is closed");
  const { clean, errors } = validateDc(input);
  if (errors.length) throw new Error(errors.join("; "));
  try {
    const { rows } = await query(
      `INSERT INTO finance.procurement_dc (purchase_id, dc_reference, dc_value, currency, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING dc_id`,
      [purchaseId, clean.dc_reference, clean.dc_value, row.currency || null, clean.notes, actorOf(actor)]);
    await audit({ actor, eventType: "procurement.dc-add", objectType: "procurement_dc", objectRef: String(rows[0].dc_id), detail: { purchase_id: purchaseId, dc_reference: clean.dc_reference } });
    return { ok: true, dc_id: rows[0].dc_id };
  } catch (e) {
    if (uniqueViolation(e)) throw new Error(`DC reference “${clean.dc_reference}” already exists on this request`);
    if (absent(e)) throw new Error("Run migration 093_procurement_dc.sql to record Documentary Credits");
    throw e;
  }
}

async function dcOwner(dcId) {
  const { rows } = await query(`SELECT dc_id, purchase_id, dc_reference FROM finance.procurement_dc WHERE dc_id=$1`, [dcId]);
  return rows[0] || null;
}

// Edit a DC — its value and (optionally) its reference. Renaming the reference
// also re-tags the request's LCs that pointed at the old reference, so the
// grouping stays intact.
export async function updateDc(dcId, input, actor) {
  const dc = await dcOwner(dcId);
  if (!dc) throw new Error("DC not found");
  const { clean, errors } = validateDc(input);
  if (errors.length) throw new Error(errors.join("; "));
  try {
    await query(`UPDATE finance.procurement_dc SET dc_reference=$2, dc_value=$3, notes=$4, updated_by=$5, updated_at=CURRENT_TIMESTAMP WHERE dc_id=$1`,
      [dcId, clean.dc_reference, clean.dc_value, clean.notes, actorOf(actor)]);
  } catch (e) {
    if (uniqueViolation(e)) throw new Error(`DC reference “${clean.dc_reference}” already exists on this request`);
    throw e;
  }
  // Re-tag LCs if the reference changed (case-insensitive compare).
  if ((dc.dc_reference || "").trim().toLowerCase() !== clean.dc_reference.toLowerCase()) {
    await query(`UPDATE finance.procurement_lc SET dc_reference=$3 WHERE purchase_id=$1 AND lower(btrim(dc_reference))=lower($2)`,
      [dc.purchase_id, (dc.dc_reference || "").trim(), clean.dc_reference]);
  }
  await audit({ actor, eventType: "procurement.dc-edit", objectType: "procurement_dc", objectRef: String(dcId), detail: { dc_value: clean.dc_value } });
  return { ok: true };
}

// Remove a DC. Its LCs are not deleted — they simply become ungrouped until
// re-assigned to another DC.
export async function deleteDc(dcId, actor) {
  const dc = await dcOwner(dcId);
  if (!dc) throw new Error("DC not found");
  await query(`DELETE FROM finance.procurement_dc WHERE dc_id=$1`, [dcId]);
  await audit({ actor, eventType: "procurement.dc-delete", objectType: "procurement_dc", objectRef: String(dcId), detail: { dc_reference: dc.dc_reference } });
  return { ok: true };
}

export async function forExport(ids = []) {
  const list = (ids || []).map(Number).filter((n) => Number.isFinite(n));
  const { rows } = list.length
    ? await query(`SELECT ${COLS} FROM finance.procurement_purchase WHERE purchase_id = ANY($1) ORDER BY created_at DESC`, [list])
    : await query(`SELECT ${COLS} FROM finance.procurement_purchase ORDER BY created_at DESC`);
  return rows;
}

// The procurement roll-up for the Merchandising dashboard + the reporting adapter.
// Committed = finance-CLOSED (invoice net where entered); open = PENDING/APPROVED;
// challenged = under query. Cash budget = the sum of the monthly procurement budgets.
export async function procurementRollup() {
  try {
    const selectPurchases = async () => {
      try { return (await query(`SELECT ${COLS_FXR} FROM finance.procurement_purchase`)).rows; }
      catch (e1) { if (!columnMissing(e1)) throw e1;
        try { return (await query(`SELECT ${COLS_FX} FROM finance.procurement_purchase`)).rows; }
        catch (e2) { if (!columnMissing(e2)) throw e2; return (await query(`SELECT ${COLS} FROM finance.procurement_purchase`)).rows; } }
    };
    const [allRows, { rows: budgets }, fxRates, meta] = await Promise.all([
      selectPurchases(),
      query(`SELECT source, ym, budget_gbp FROM finance.procurement_budget`).catch(() => ({ rows: [] })),
      getFxRates().catch(() => []),
      supplierMetaByNorm().catch(() => new Map()),
    ]);
    // Classify each row by its supplier's master source (MINISO/LOCAL/OTHER) and
    // read its Active-to-Merch flag. Suppliers marked not-in-merch are excluded
    // from the merch reports + dashboard entirely.
    for (const r of allRows) {
      const m = meta.get(normNm(r.supplier));
      r.report_source = classifySource(r, m);
      r.active_merch = m ? m.active_merch !== false : true;
    }
    const excludedMerch = allRows.filter((r) => r.active_merch === false).length;
    const rows = allRows.filter((r) => r.active_merch !== false);
    attachReportGbp(rows, fxRates);
    const closed = rows.filter((r) => r.finance_status === "CLOSED");
    const open = rows.filter((r) => r.finance_status === "PENDING" || r.finance_status === "APPROVED");
    const pending = rows.filter((r) => r.finance_status === "PENDING");
    const challenged = rows.filter((r) => r.finance_status === "CHALLENGED");
    const register = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ---- Documentary Credit drawdown (Miniso HQ) ----
    // Consolidate every DC across the merch-active Miniso requests: used (logged
    // LCs) vs the DC value → balance remaining. Denominated in the DC currency
    // (USD) — a facility-balance concept, not the reported GBP.
    const minisoIds = rows.filter((r) => r.source === "MINISO").map((r) => r.purchase_id);
    const dcRows = [];
    if (minisoIds.length) {
      const [dcRecs, lcRecs] = await Promise.all([
        query(`SELECT ${DC_COLS} FROM finance.procurement_dc WHERE purchase_id = ANY($1)`, [minisoIds]).then((r) => r.rows).catch(() => []),
        query(`SELECT purchase_id, dc_reference, lc_amount, lc_settled, lc_settled_amount FROM finance.procurement_lc WHERE purchase_id = ANY($1)`, [minisoIds]).then((r) => r.rows).catch(() => []),
      ]);
      const dcByPid = {}, lcByPid = {}, refByPid = {}, ccyByPid = {};
      for (const d of dcRecs) (dcByPid[d.purchase_id] ||= []).push(d);
      for (const l of lcRecs) (lcByPid[l.purchase_id] ||= []).push(l);
      for (const r of rows) { refByPid[r.purchase_id] = r.reference || `#${r.purchase_id}`; ccyByPid[r.purchase_id] = r.currency || "USD"; }
      for (const pid of minisoIds) {
        for (const g of dcDrawdown(dcByPid[pid] || [], lcByPid[pid] || [])) {
          if (g.ungrouped) continue;   // report against real DC records only
          dcRows.push({ purchase_id: pid, purchaseRef: refByPid[pid], currency: ccyByPid[pid],
            dc_reference: g.dc_reference, dc_value: g.dc_value, used: g.used, settled: g.settled,
            remaining: g.remaining, over: g.over, count: g.count });
        }
      }
    }
    const dcWithValue = dcRows.filter((d) => d.dc_value != null);
    const dc = {
      count: dcRows.length,
      currency: dcRows[0]?.currency || "USD",
      totalValue: round2(dcWithValue.reduce((t, d) => t + (d.dc_value || 0), 0)),
      totalUsed: round2(dcRows.reduce((t, d) => t + (d.used || 0), 0)),
      totalRemaining: round2(dcWithValue.reduce((t, d) => t + (d.remaining || 0), 0)),
      overCount: dcRows.filter((d) => d.over).length,
      rows: dcRows.sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 50),
    };

    return {
      ready: true,
      count: rows.length,
      committed: round2(closed.reduce((t, r) => t + committedAmount(r), 0)),
      committedCount: closed.length,
      open: round2(open.reduce((t, r) => t + lineValue(r), 0)),
      openCount: open.length,
      pendingCount: pending.length,
      challenged: challenged.slice(0, 20),
      challengedCount: challenged.length,
      challengedValue: round2(challenged.reduce((t, r) => t + committedAmount(r), 0)),
      register: register.slice(0, 200),
      registerCount: rows.length,
      excludedMerch,
      dc,
      cashBudget: round2(budgets.reduce((t, b) => t + (Number(b.budget_gbp) || 0), 0)),
    };
  } catch (e) {
    if (absent(e)) return { ready: false, count: 0 };
    throw e;
  }
}
