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
import { financeActionError, isProcChallengeReason, isProcPaymentStatus, committedAmount, lineValue, lcActionError, LC_BANK_DEFAULT } from "./procurement-close-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "42703" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const COLS = `purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference,
  source_tag, channel_code, otb_version_id, otb_period, request_status, sku_or_range, units, landed_cost,
  po_id, validation_status, finance_status, approved_by, approved_at, invoice_number, invoice_amount,
  challenge_reasons, challenge_note, challenged_by, challenged_at, closed_by, closed_at, payment_status, paid_date,
  lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date, lc_settled, lc_settled_date, lc_settled_amount,
  created_by, created_at`;

export async function listForClose({ source = null, financeStatus = null, limit = 500 } = {}) {
  try {
    const { rows } = await query(
      `SELECT ${COLS} FROM finance.procurement_purchase
        WHERE ($1::varchar IS NULL OR source = $1)
          AND ($2::varchar IS NULL OR finance_status = $2)
        ORDER BY (finance_status = 'CLOSED'), created_at DESC
        LIMIT $3`, [source, financeStatus, limit]);
    return { ready: true, rows };
  } catch (e) {
    if (absent(e)) return { ready: false, rows: [] };
    throw e;
  }
}

export async function getProcurementLine(id) {
  const { rows } = await query(`SELECT ${COLS} FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  return rows[0] || null;
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
    const [{ rows }, { rows: budgets }] = await Promise.all([
      query(`SELECT ${COLS} FROM finance.procurement_purchase`),
      query(`SELECT source, ym, budget_gbp FROM finance.procurement_budget`).catch(() => ({ rows: [] })),
    ]);
    const closed = rows.filter((r) => r.finance_status === "CLOSED");
    const open = rows.filter((r) => r.finance_status === "PENDING" || r.finance_status === "APPROVED");
    const pending = rows.filter((r) => r.finance_status === "PENDING");
    const challenged = rows.filter((r) => r.finance_status === "CHALLENGED");
    const register = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
      cashBudget: round2(budgets.reduce((t, b) => t + (Number(b.budget_gbp) || 0), 0)),
    };
  } catch (e) {
    if (absent(e)) return { ready: false, count: 0 };
    throw e;
  }
}
