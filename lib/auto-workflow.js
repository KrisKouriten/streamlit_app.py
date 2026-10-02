import { query } from "./db";
import { audit } from "./governance";
import { getApproverEmails } from "./dept-budget";
import { lastInvoiceChases } from "./purchase-orders";
import { notifyAutoCancelled, notifyPoInvoiceChase } from "./workflow-notify";
import { poRef, invoiceChaseStatus } from "./po-rules.js";
import { procRef } from "./procurement-close-rules.js";
import { challengeLapse, autoCancelReason, autoChaseDue, AUTO_ACTOR } from "./auto-workflow-rules.js";

/*
 * The daily automatic follow-ups (rules in auto-workflow-rules.js), run by the
 * workflow cron on working-day mornings:
 *
 *   1. challenged P.Os not resubmitted within 5 working days → CANCELLED
 *   2. challenged procurement requests, the same → approval_status CANCELLED
 *   3. P.Os Finance have chased once, still with no invoice 5 working days
 *      after the last chase → chased again automatically
 *
 * Each item is handled on its own: one that fails is reported and the run
 * carries on. Every action is written to the audit log under AUTO_ACTOR, so the
 * P.O timeline and the audit trail say it was the app, not a person.
 * `dryRun` reports what would happen without changing anything or sending.
 */

const missing = (e) => e?.code === "42P01" || e?.code === "42703";

async function cancelChallengedPos(today, baseUrl, dryRun) {
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT * FROM finance.purchase_order WHERE status = 'APPROVED' AND finance_status = 'CHALLENGED'`));
  } catch (e) { if (missing(e)) return { cancelled: [], errors: [] }; throw e; }
  const cancelled = [], errors = [];
  for (const po of rows) {
    const lapse = challengeLapse(po, today, "PO");
    if (!lapse.lapsed) continue;
    const ref = poRef(po), reason = autoCancelReason(po);
    const item = { id: po.po_id, ref, department: po.department, supplier: po.supplier, value: Number(po.payment_value) || 0, deadline: lapse.deadline };
    if (dryRun) { cancelled.push(item); continue; }
    try {
      // Guarded on the same state, so a P.O resubmitted since the SELECT is left alone.
      const { rowCount } = await query(
        `UPDATE finance.purchase_order SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
          WHERE po_id = $1 AND status = 'APPROVED' AND finance_status = 'CHALLENGED'`, [po.po_id]);
      if (!rowCount) continue;
      await audit({ actor: AUTO_ACTOR, eventType: "purchase_order.auto_cancel", objectType: "purchase_order", objectRef: String(po.po_id),
        detail: { ref, reason, challenged_at: po.challenged_at, deadline: lapse.deadline } });
      await notifyAutoCancelled({ kind: "PO", ref, supplier: po.supplier, value: po.payment_value, createdBy: po.created_by, objectRef: po.po_id, reason, baseUrl })
        .catch((e) => console.error("auto-cancel notify failed:", e.message));
      cancelled.push(item);
    } catch (e) { errors.push(`${ref}: ${e.message}`); }
  }
  return { cancelled, errors };
}

/*
 * When each challenged procurement request was last amended by the team who
 * raised it — { [purchase_id]: ISO timestamp }. Amending is how Merch answer a
 * challenge, so an amendment after the challenge stops the clock. Read from the
 * audit log; empty (never throws) when there is none.
 */
export async function procurementAmendments() {
  try {
    const { rows } = await query(
      `SELECT object_ref, max(occurred_at) AS at FROM governance.audit_event
        WHERE object_type = 'procurement_purchase' AND event_type IN ('procurement.amend-supplier', 'procurement.amend')
        GROUP BY object_ref`);
    const out = {};
    for (const r of rows) out[r.object_ref] = r.at instanceof Date ? r.at.toISOString() : String(r.at);
    return out;
  } catch { return {}; }
}

async function cancelChallengedProcurement(today, baseUrl, dryRun) {
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT * FROM finance.procurement_purchase
        WHERE finance_status = 'CHALLENGED' AND COALESCE(approval_status, 'APPROVED') <> 'CANCELLED'`));
  } catch (e) { if (missing(e)) return { cancelled: [], errors: [] }; throw e; }
  const amended = rows.length ? await procurementAmendments() : {};
  const cancelled = [], errors = [];
  for (const r of rows) {
    const lapse = challengeLapse(r, today, "PROCUREMENT", undefined, { amendedAt: amended[String(r.purchase_id)] });
    if (!lapse.lapsed) continue;
    const ref = procRef(r), reason = autoCancelReason(r);
    const item = { id: r.purchase_id, ref, source: r.source, supplier: r.supplier, value: Number(r.amount_gbp) || 0, deadline: lapse.deadline };
    if (dryRun) { cancelled.push(item); continue; }
    try {
      const { rowCount } = await query(
        `UPDATE finance.procurement_purchase
            SET approval_status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3
          WHERE purchase_id = $1 AND finance_status = 'CHALLENGED' AND COALESCE(approval_status, 'APPROVED') <> 'CANCELLED'`,
        [r.purchase_id, AUTO_ACTOR.name, reason]);
      if (!rowCount) continue;
      await audit({ actor: AUTO_ACTOR, eventType: "procurement.auto_cancel", objectType: "procurement_purchase", objectRef: String(r.purchase_id),
        detail: { ref, reason, challenged_at: r.challenged_at, deadline: lapse.deadline } });
      await notifyAutoCancelled({ kind: "PROCUREMENT", ref, supplier: r.supplier, value: r.amount_gbp, createdBy: r.created_by, objectRef: r.purchase_id, reason, baseUrl })
        .catch((e) => console.error("auto-cancel notify failed:", e.message));
      cancelled.push(item);
    } catch (e) { errors.push(`${ref}: ${e.message}`); }
  }
  return { cancelled, errors };
}

async function autoChaseInvoices(today, baseUrl, dryRun) {
  const chases = await lastInvoiceChases();
  const ids = Object.keys(chases).map(Number).filter(Number.isFinite);
  if (!ids.length) return { chased: [], errors: [] };
  let rows = [];
  try {
    ({ rows } = await query(`SELECT * FROM finance.purchase_order WHERE po_id = ANY($1::bigint[])`, [ids]));
  } catch (e) { if (missing(e)) return { chased: [], errors: [] }; throw e; }
  const chased = [], errors = [];
  for (const po of rows) {
    const last = chases[String(po.po_id)];
    const due = autoChaseDue(po, last, today);
    if (!due.due) continue;
    const ref = poRef(po);
    const chase = invoiceChaseStatus(po, today);
    const item = { id: po.po_id, ref, department: po.department, supplier: po.supplier, lastChased: last.at, times: last.times };
    if (dryRun) { chased.push(item); continue; }
    try {
      const hodEmails = await getApproverEmails(po.department).catch(() => []);
      const sent = await notifyPoInvoiceChase({ po, hodEmails, chase, actor: AUTO_ACTOR, baseUrl, automatic: true });
      // The audit row is what the next run counts from, so it is written even
      // when email is not configured — the in-app notification still went.
      await audit({ actor: AUTO_ACTOR, eventType: "po.invoice_chase", objectType: "purchase_order", objectRef: String(po.po_id),
        detail: { ref, recipients: sent.recipients, days_over: chase.daysOver, emailed: sent.emailed, automatic: true } });
      chased.push({ ...item, recipients: sent.recipients, emailed: sent.emailed });
    } catch (e) { errors.push(`${ref}: ${e.message}`); }
  }
  return { chased, errors };
}

export async function runAutoWorkflow({ today = new Date(), baseUrl = null, dryRun = false } = {}) {
  const [pos, procurement, invoices] = [
    await cancelChallengedPos(today, baseUrl, dryRun),
    await cancelChallengedProcurement(today, baseUrl, dryRun),
    await autoChaseInvoices(today, baseUrl, dryRun),
  ];
  return {
    ok: true, dryRun,
    posCancelled: pos.cancelled,
    procurementCancelled: procurement.cancelled,
    invoicesChased: invoices.chased,
    errors: [...pos.errors, ...procurement.errors, ...invoices.errors],
  };
}
