import { query } from "./db";
import { audit, getPoSelfApproveLimit, getDeptPoPolicy } from "./governance";
import { autofillRechargeToIntercompany } from "./intercompany.js";
import {
  validatePo, canSubmitForSignoff, rechargeAmounts, invoiceOutcome,
  poTransitionError, isEditablePo, canEditPo, headOfficeLine, canDeletePo, financeActionError,
  isPaymentStatus, isSignedOff,
  challengeValidationError, isChallengeReturnRoute, DEFAULT_CHALLENGE_RETURN_ROUTE,
  validatePoInvoice, invoiceTotals, derivePaymentStatus, invoiceSummaryRef,
  selfApprovalDecision, PO_APPROVAL_ROUTES,
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

// Mint the next unique, non-reusable P.O number from the sequence (migration
// 062). Best-effort: returns null before the column/sequence exist so create
// still works pre-migration (display then falls back to the id via poRef).
async function assignPoNumber(poId) {
  try {
    const { rows } = await query(
      `UPDATE finance.purchase_order
         SET po_number = 'PO-' || lpad(nextval('finance.po_number_seq')::text, 4, '0')
       WHERE po_id = $1 AND po_number IS NULL
       RETURNING po_number`,
      [poId]);
    return rows[0]?.po_number || null;
  } catch (e) {
    if (e?.code === "42P01" || e?.code === "42703") return null;  // pre-062
    throw e;
  }
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
     input.po_category, input.xero_po_number ? String(input.xero_po_number).trim() : null, input.fulfilment_start_date || null,
     input.fulfilment_days != null && input.fulfilment_days !== "" ? Number(input.fulfilment_days) : null,
     input.department.trim(), !!input.is_marketing, input.is_marketing ? (input.marketing_levy ?? null) : null,
     !!input.recharge_enabled, !!input.recharge_ho_only, invoice_action, input.notes || null, actorOf(actor)]
  );
  const poId = rows[0].po_id;
  const poNumber = await assignPoNumber(poId);
  const lines = rechargeLinesFor(input);
  if (lines.length) await replaceRecharge(poId, lines, Number(input.payment_value));
  // Marketing budget link (migration 053) — best-effort so it degrades cleanly
  // before the columns exist.
  if (input.marketing_budget_category || input.marketing_campaign) {
    try {
      await query(
        `UPDATE finance.purchase_order SET marketing_budget_category = $2, marketing_campaign = $3 WHERE po_id = $1`,
        [poId, input.marketing_budget_category || null, input.marketing_campaign || null]);
    } catch (e) { if (e?.code !== "42703") throw e; }
  }
  // Business-project allocation (migration 088) — best-effort, degrades pre-088.
  if (input.business_project_id) {
    try {
      await query(`UPDATE finance.purchase_order SET business_project_id = $2 WHERE po_id = $1`,
        [poId, Number(input.business_project_id)]);
    } catch (e) { if (e?.code !== "42703") throw e; }
  }
  await audit({ actor, eventType: "purchase_order.create", objectType: "purchase_order", objectRef: String(poId), detail: { supplier: input.supplier, value: input.payment_value, department: input.department, po_number: poNumber } });
  return { poId, poNumber };
}

// Distinct campaign / initiative names from the Marketing department's budgets —
// suggestions for the marketing budget link on a P.O. Empty before migration 051.
export async function marketingCampaignSuggestions() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT i.name FROM finance.dept_budget_initiative i
         JOIN finance.dept_budget b ON b.budget_id = i.budget_id
        WHERE b.department = 'Marketing' AND i.name IS NOT NULL AND i.name <> ''
        ORDER BY i.name`);
    return rows.map((r) => r.name);
  } catch (e) { if (e?.code === "42P01" || e?.code === "42703") return []; throw e; }
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
  const { rows } = await query(`SELECT status, finance_status FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  if (!rows.length) throw new Error("P.O not found");
  if (!canEditPo(rows[0])) {
    const label = rows[0].finance_status === "CLOSED" ? "closed" : rows[0].status.replace(/_/g, " ").toLowerCase();
    throw new Error(`This P.O is ${label} and cannot be edited`);
  }
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
  // Marketing budget link (migration 053) + business-project allocation (088) —
  // best-effort so an edit degrades cleanly before those columns exist.
  if ("marketing_budget_category" in patch || "marketing_campaign" in patch) {
    try {
      await query(`UPDATE finance.purchase_order SET marketing_budget_category = $2, marketing_campaign = $3 WHERE po_id = $1`,
        [poId, merged.marketing_budget_category || null, merged.marketing_campaign || null]);
    } catch (e) { if (e?.code !== "42703") throw e; }
  }
  if ("business_project_id" in patch) {
    try {
      await query(`UPDATE finance.purchase_order SET business_project_id = $2 WHERE po_id = $1`,
        [poId, patch.business_project_id ? Number(patch.business_project_id) : null]);
    } catch (e) { if (e?.code !== "42703") throw e; }
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
    const invoices = await listPoInvoices(poId);
    return { po, recharge, invoices };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

// ---- Multiple invoices per P.O (migration 099) ----

// The invoices logged against a P.O. Empty (never throws) before migration 099.
export async function listPoInvoices(poId) {
  try {
    const { rows } = await query(
      `SELECT invoice_id, po_id, invoice_number, invoice_amount, invoice_date, paid, paid_date, created_by, created_at
         FROM finance.purchase_order_invoice WHERE po_id = $1 ORDER BY created_at, invoice_id`, [poId]);
    return rows.map((r) => ({ ...r, invoice_amount: r.invoice_amount == null ? null : Number(r.invoice_amount) }));
  } catch (e) { if (tableMissing(e)) return []; throw e; }
}

// Recompute the P.O's invoice rollup from its child invoices: the parent
// invoice_amount (sum), a summary invoice_number, and the derived payment status
// (Unpaid / Part-paid / Paid) with its paid date. When the last invoice is
// removed the rollup reverts to no invoice / Unpaid.
async function recomputePoInvoiceRollup(poId, actor) {
  const invoices = await listPoInvoices(poId);
  // The P.O value the paid invoices are measured against — a P.O is only PAID
  // once the paid invoices cover it, otherwise it stays PART_PAID.
  const { rows: pvRows } = await query(`SELECT payment_value FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  const poValue = pvRows.length ? Number(pvRows[0].payment_value) : null;
  const totals = invoiceTotals(invoices);
  const derived = derivePaymentStatus(invoices, poValue);
  if (!invoices.length) {
    await query(
      `UPDATE finance.purchase_order
         SET invoice_number = NULL, invoice_amount = NULL, payment_status = 'UNPAID', paid_date = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`, [poId]);
    return { payment_status: "UNPAID", total: 0 };
  }
  // paid_date = the latest paid invoice's date, when fully paid.
  const paidDates = invoices.filter((i) => i.paid && i.paid_date).map((i) => i.paid_date).sort();
  const paidDate = derived === "UNPAID" ? null : (paidDates.length ? paidDates[paidDates.length - 1] : null);
  await query(
    `UPDATE finance.purchase_order
       SET invoice_number = $2, invoice_amount = $3, payment_status = $4, paid_date = $5, updated_at = CURRENT_TIMESTAMP
     WHERE po_id = $1`,
    [poId, invoiceSummaryRef(invoices), totals.total, derived, paidDate]);
  return { payment_status: derived, total: totals.total, count: totals.count };
}

export async function addPoInvoice(poId, input = {}, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  if (!isSignedOff(loaded.po)) throw new Error("This P.O has not been signed off yet");
  const err = validatePoInvoice(input);
  if (err) throw new Error(err);
  const paid = !!input.paid;
  const paidDate = paid ? (input.paid_date || new Date().toISOString().slice(0, 10)) : null;
  await query(
    `INSERT INTO finance.purchase_order_invoice (po_id, invoice_number, invoice_amount, invoice_date, paid, paid_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [poId, String(input.invoice_number).trim(), Number(input.invoice_amount), input.invoice_date || null, paid, paidDate, actorOf(actor)]);
  const roll = await recomputePoInvoiceRollup(poId, actor);
  await audit({ actor, eventType: "purchase_order.invoice_add", objectType: "purchase_order", objectRef: String(poId), detail: { invoice_number: input.invoice_number, amount: input.invoice_amount, paid } });
  return { ok: true, ...roll };
}

export async function updatePoInvoice(invoiceId, patch = {}, actor) {
  const { rows } = await query(`SELECT po_id FROM finance.purchase_order_invoice WHERE invoice_id = $1`, [invoiceId]);
  if (!rows.length) throw new Error("Invoice not found");
  const poId = rows[0].po_id;
  const sets = [], vals = []; let i = 1;
  if ("invoice_number" in patch) { sets.push(`invoice_number = $${i++}`); vals.push(String(patch.invoice_number || "").trim() || null); }
  if ("invoice_amount" in patch) { sets.push(`invoice_amount = $${i++}`); vals.push(patch.invoice_amount == null || patch.invoice_amount === "" ? null : Number(patch.invoice_amount)); }
  if ("invoice_date" in patch) { sets.push(`invoice_date = $${i++}`); vals.push(patch.invoice_date || null); }
  if ("paid" in patch) {
    sets.push(`paid = $${i++}`); vals.push(!!patch.paid);
    const pd = patch.paid ? (patch.paid_date || new Date().toISOString().slice(0, 10)) : null;
    sets.push(`paid_date = $${i++}`); vals.push(pd);
  }
  if (!sets.length) return { ok: true };
  vals.push(invoiceId);
  await query(`UPDATE finance.purchase_order_invoice SET ${sets.join(", ")} WHERE invoice_id = $${i}`, vals);
  const roll = await recomputePoInvoiceRollup(poId, actor);
  await audit({ actor, eventType: "purchase_order.invoice_update", objectType: "purchase_order", objectRef: String(poId), detail: { invoiceId, fields: Object.keys(patch) } });
  return { ok: true, ...roll };
}

export async function deletePoInvoice(invoiceId, actor) {
  const { rows } = await query(`DELETE FROM finance.purchase_order_invoice WHERE invoice_id = $1 RETURNING po_id`, [invoiceId]);
  if (!rows.length) throw new Error("Invoice not found");
  const roll = await recomputePoInvoiceRollup(rows[0].po_id, actor);
  await audit({ actor, eventType: "purchase_order.invoice_delete", objectType: "purchase_order", objectRef: String(rows[0].po_id), detail: { invoiceId } });
  return { ok: true, ...roll };
}

export async function listPos({ owner = null, status = null, department = null, financeStatus = null, limit = 200 } = {}) {
  try {
    // SELECT * so finance columns (migration 052) come through when present.
    const { rows } = await query(
      `SELECT * FROM finance.purchase_order
       WHERE ($1::varchar IS NULL OR created_by = $1)
         AND ($2::varchar IS NULL OR status = $2)
         AND ($3::varchar IS NULL OR department = $3)
         AND ($4::varchar IS NULL OR finance_status = $4)
       ORDER BY created_at DESC LIMIT $5`,
      [owner, status, department, financeStatus, limit]
    );
    return { ready: true, pos: rows };
  } catch (e) {
    if (e?.code === "42703") {
      // pre-052 (no finance_status column) — fall back without that filter.
      const { rows } = await query(
        `SELECT * FROM finance.purchase_order
         WHERE ($1::varchar IS NULL OR created_by = $1) AND ($2::varchar IS NULL OR status = $2)
           AND ($3::varchar IS NULL OR department = $3) ORDER BY created_at DESC LIMIT $4`,
        [owner, status, department, limit]);
      return { ready: true, pos: rows };
    }
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

  // Self sign-off: the per-department policy (migration 063) decides whether the
  // creator's own P.O can be signed off automatically. The decision reflects the
  // MOST RESTRICTIVE of the count limit, individual value cap and cumulative value
  // cap; when a department has no policy the org-wide £ limit applies. Only the
  // creator can self-approve — a non-creator submitting always routes to sign-off.
  const isCreator = actorOf(actor) === loaded.po.created_by;
  const { decision, policy } = await computeSelfApprovalDecision({
    department: loaded.po.department, value: loaded.po.payment_value,
  });

  if (isCreator && decision.selfApprove) {
    await query(
      `UPDATE finance.purchase_order
         SET status = 'APPROVED', self_approved = true, approval_route = $3, route_original = $3,
             applied_policy_id = $4, approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`, [poId, actorOf(actor), decision.route, policy?.policy_id || null]);
    await audit({ actor, eventType: "purchase_order.self_approve", objectType: "purchase_order", objectRef: String(poId),
      detail: { route: decision.route, value: loaded.po.payment_value, usedCount: decision.usedCount, usedValue: decision.usedValue,
        countLimit: decision.countLimit, maxIndividual: decision.maxIndividual, maxCumulative: decision.maxCumulative, policyId: policy?.policy_id || null } });
    return { ok: true, status: "APPROVED", selfApproved: true, route: decision.route };
  }

  // Route to sign-off — line manager where the policy names one, else the
  // department's sign-off approvers. Records the route and why for the audit trail.
  const route = decision.route === PO_APPROVAL_ROUTES.SELF ? PO_APPROVAL_ROUTES.DEPT : decision.route;
  await query(
    `UPDATE finance.purchase_order
       SET status = 'PENDING_SIGNOFF', approval_route = $2, route_original = $2, applied_policy_id = $3, updated_at = CURRENT_TIMESTAMP
     WHERE po_id = $1`, [poId, route, policy?.policy_id || null]);
  await audit({ actor, eventType: "purchase_order.submit_for_signoff", objectType: "purchase_order", objectRef: String(poId),
    detail: { route, isCreator, reasons: decision.reasons, binding: decision.binding, policyId: policy?.policy_id || null } });
  return { ok: true, status: "PENDING_SIGNOFF", route, reasons: decision.reasons };
}

// Count + cumulative value of a department's self-approved P.Os in the current
// measurement period, honouring the cancelled-P.O counting policy. A P.O consumes
// self-approval capacity once it is APPROVED and self_approved; under
// RETAIN_IN_COUNT a subsequently-cancelled P.O still counts (so cancelling cannot
// regain capacity). FINANCIAL_PERIOD/FINANCIAL_YEAR currently align to the calendar
// month/year — anchor to a fiscal calendar later if the finance calendar differs.
export async function selfApprovalUsage(department, policy) {
  const period = policy?.measurement_period || "FINANCIAL_PERIOD";
  const retain = (policy?.cancelled_po_policy || "RETAIN_IN_COUNT") === "RETAIN_IN_COUNT";
  let startExpr;
  switch (period) {
    case "CALENDAR_QUARTER": startExpr = "date_trunc('quarter', CURRENT_TIMESTAMP)"; break;
    case "FINANCIAL_YEAR": startExpr = "date_trunc('year', CURRENT_TIMESTAMP)"; break;
    case "ROLLING_30_DAYS": startExpr = "CURRENT_TIMESTAMP - interval '30 days'"; break;
    case "CUSTOM_PERIOD": startExpr = "CURRENT_TIMESTAMP - ($2 * interval '1 day')"; break;
    default: startExpr = "date_trunc('month', CURRENT_TIMESTAMP)"; // CALENDAR_MONTH / FINANCIAL_PERIOD
  }
  const statusClause = retain ? "status IN ('APPROVED','CANCELLED')" : "status = 'APPROVED'";
  const params = period === "CUSTOM_PERIOD" ? [department, Number(policy?.custom_period_days) || 30] : [department];
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(payment_value), 0)::numeric AS cumulative
         FROM finance.purchase_order
        WHERE department = $1 AND self_approved = true AND ${statusClause}
          AND approved_at >= ${startExpr}`, params);
    return { count: rows[0].count, cumulativeValue: Number(rows[0].cumulative) };
  } catch (e) {
    if (tableMissing(e) || e?.code === "42703") return { count: 0, cumulativeValue: 0 };
    throw e;
  }
}

// Resolve the self-approval decision for a { department, value } — the policy, the
// current period usage, and the outcome. Used at submit time and by the live
// "Self-approval status" preview on Purchase Order Requests.
export async function computeSelfApprovalDecision({ department, value }) {
  const policy = await getDeptPoPolicy(department).catch(() => null);
  const orgLimit = await getPoSelfApproveLimit().catch(() => 0);
  const usage = policy ? await selfApprovalUsage(department, policy) : { count: 0, cumulativeValue: 0 };
  const decision = selfApprovalDecision({ value, policy, usage, orgLimit });
  return { decision, policy, usage, orgLimit };
}

// Preview the decision for an existing draft P.O (by id).
export async function selfApprovalPreview(poId) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  const { decision } = await computeSelfApprovalDecision({ department: loaded.po.department, value: loaded.po.payment_value });
  return decision;
}

// An authorised approver (never the requester) overrides the automatic route. When
// they override to SELF_APPROVED the P.O is approved; otherwise it is held for the
// named route. The original route, the reviser, the reason and any evidence are
// all recorded. SoD (actor ≠ creator) and role are enforced in the API.
export async function overrideRoute(poId, { route, reason, evidence } = {}, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  if (!reason || !String(reason).trim()) throw new Error("An override reason is required");
  const validRoutes = Object.values(PO_APPROVAL_ROUTES);
  if (!validRoutes.includes(route)) throw new Error("Choose a valid revised route");
  const approve = route === PO_APPROVAL_ROUTES.SELF;
  await query(
    `UPDATE finance.purchase_order
       SET approval_route = $2,
           route_override_by = $3, route_override_reason = $4, route_override_at = CURRENT_TIMESTAMP,
           status = CASE WHEN $5 THEN 'APPROVED' ELSE 'PENDING_SIGNOFF' END,
           approved_by = CASE WHEN $5 THEN $3 ELSE approved_by END,
           approved_at = CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE approved_at END,
           updated_at = CURRENT_TIMESTAMP
     WHERE po_id = $1`, [poId, route, actorOf(actor), String(reason).trim(), approve]);
  await audit({ actor, eventType: "purchase_order.override_route", objectType: "purchase_order", objectRef: String(poId),
    detail: { original: loaded.po.route_original || loaded.po.approval_route || null, revised: route, reason: String(reason).trim(), evidence: evidence || null } });
  return { ok: true, route, approved: approve };
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

// ---- Department-head sign-off ----
export async function approvePo(poId, actor) {
  const { rows } = await query(`SELECT status FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  if (!rows.length) throw new Error("P.O not found");
  const tErr = poTransitionError("approve", rows[0].status);
  if (tErr) throw new Error(tErr);
  await query(`UPDATE finance.purchase_order SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`,
    [poId, actor?.email || actor?.name || "system"]);
  await audit({ actor, eventType: "purchase_order.approve", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true, status: "APPROVED" };
}

export async function rejectPo(poId, actor) {
  const { rows } = await query(`SELECT status FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  if (!rows.length) throw new Error("P.O not found");
  const tErr = poTransitionError("reject", rows[0].status);
  if (tErr) throw new Error(tErr);
  await query(`UPDATE finance.purchase_order SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`, [poId]);
  await audit({ actor, eventType: "purchase_order.reject", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true, status: "REJECTED" };
}

// Delete a P.O. Gating (canDeletePo — admin-only once signed off) is enforced in
// the API where the session role is known; here we just remove it + its recharge.
export async function deletePo(poId, actor) {
  await query(`DELETE FROM finance.purchase_order_recharge WHERE po_id = $1`, [poId]);
  await query(`DELETE FROM finance.purchase_order WHERE po_id = $1`, [poId]);
  await audit({ actor, eventType: "purchase_order.delete", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true };
}

// ---- Finance: invoice capture, close & challenge (P.O Summary + Close) ----
export async function setInvoice(poId, { invoice_number, invoice_amount }, actor) {
  await query(
    `UPDATE finance.purchase_order SET invoice_number = $2, invoice_amount = $3, updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`,
    [poId, invoice_number || null, invoice_amount == null || invoice_amount === "" ? null : Number(invoice_amount)]
  );
  await audit({ actor, eventType: "purchase_order.set_invoice", objectType: "purchase_order", objectRef: String(poId), detail: { invoice_number } });
  return { ok: true };
}

// Finance maintains the payment status (Unpaid / Part-paid / Paid) against a
// signed-off P.O so the raising department can see whether it has been paid. A
// paid date is recorded when marked PAID (cleared otherwise).
export async function setPaymentStatus(poId, { payment_status, paid_date } = {}, actor) {
  if (!isPaymentStatus(payment_status)) throw new Error("Unknown payment status");
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  if (!isSignedOff(loaded.po)) throw new Error("This P.O has not been signed off yet");
  const paid = payment_status === "PAID" ? (paid_date || new Date().toISOString().slice(0, 10)) : (paid_date || null);
  await query(
    `UPDATE finance.purchase_order SET payment_status = $2, paid_date = $3, updated_at = CURRENT_TIMESTAMP WHERE po_id = $1`,
    [poId, payment_status, paid]);
  await audit({ actor, eventType: "purchase_order.set_payment_status", objectType: "purchase_order", objectRef: String(poId), detail: { payment_status, paid_date: paid } });
  return { ok: true, payment_status, paid_date: paid };
}

export async function closePo(poId, { invoice_number, invoice_amount } = {}, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  const err = financeActionError("close", loaded.po);
  if (err) throw new Error(err);
  await query(
    `UPDATE finance.purchase_order
       SET finance_status = 'CLOSED', closed_by = $2, closed_at = CURRENT_TIMESTAMP,
           invoice_number = COALESCE($3, invoice_number), invoice_amount = COALESCE($4, invoice_amount),
           challenge_reasons = NULL, challenge_note = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE po_id = $1`,
    [poId, actor?.email || actor?.name || "system", invoice_number || null,
     invoice_amount == null || invoice_amount === "" ? null : Number(invoice_amount)]
  );
  await audit({ actor, eventType: "purchase_order.close", objectType: "purchase_order", objectRef: String(poId) });

  // A recharge P.O auto-posts its allocation onto the Inventory & Recharges
  // ledger on close (one draft row per store). Best-effort — never blocks the
  // close if the intercompany post fails.
  let recharge = { created: 0 };
  if (loaded.po.recharge_enabled) {
    const merged = { ...loaded.po, finance_status: "CLOSED",
      invoice_number: invoice_number || loaded.po.invoice_number,
      invoice_amount: invoice_amount == null || invoice_amount === "" ? loaded.po.invoice_amount : Number(invoice_amount) };
    try {
      recharge = await autofillRechargeToIntercompany({ po: merged, recharge: loaded.recharge }, actor);
    } catch (e) { recharge = { created: 0, error: e.message }; }
  }
  return { ok: true, finance_status: "CLOSED", recharge };
}

export async function challengePo(poId, { reasons = [], note = null, returnRoute = null } = {}, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  const err = financeActionError("challenge", loaded.po);
  if (err) throw new Error(err);
  const vErr = challengeValidationError({ reasons, note, returnRoute });
  if (vErr) throw new Error(vErr);
  const route = isChallengeReturnRoute(returnRoute) ? returnRoute : DEFAULT_CHALLENGE_RETURN_ROUTE;
  // challenge_return_route is best-effort so a pre-098 database still challenges.
  try {
    await query(
      `UPDATE finance.purchase_order
         SET finance_status = 'CHALLENGED', challenge_reasons = $2, challenge_note = $3,
             challenge_return_route = $5, challenged_by = $4, challenged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`,
      [poId, reasons.join(","), note || null, actor?.email || actor?.name || "system", route]
    );
  } catch (e) {
    if (e?.code !== "42703") throw e;  // pre-098: no challenge_return_route column
    await query(
      `UPDATE finance.purchase_order
         SET finance_status = 'CHALLENGED', challenge_reasons = $2, challenge_note = $3,
             challenged_by = $4, challenged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`,
      [poId, reasons.join(","), note || null, actor?.email || actor?.name || "system"]
    );
  }
  await audit({ actor, eventType: "purchase_order.challenge", objectType: "purchase_order", objectRef: String(poId), detail: { reasons, returnRoute: route } });
  return { ok: true, finance_status: "CHALLENGED", challenge_return_route: route };
}

// The submitter resolves a challenge: after editing the P.O they resubmit it. The
// route Finance chose on the challenge decides where it lands — straight back to
// Finance (finance_status → OPEN) or back through department sign-off first
// (status → PENDING_SIGNOFF). Either way the challenge is cleared.
export async function resubmitChallenge(poId, actor) {
  const loaded = await getPo(poId);
  if (!loaded) throw new Error("P.O not found");
  if (loaded.po.finance_status !== "CHALLENGED") throw new Error("This P.O is not under challenge");
  const route = isChallengeReturnRoute(loaded.po.challenge_return_route)
    ? loaded.po.challenge_return_route : DEFAULT_CHALLENGE_RETURN_ROUTE;
  if (route === "TO_SIGNOFF") {
    await query(
      `UPDATE finance.purchase_order
         SET status = 'PENDING_SIGNOFF', approved_by = NULL, approved_at = NULL,
             finance_status = 'OPEN', challenge_reasons = NULL, challenge_note = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`, [poId]);
  } else {
    await query(
      `UPDATE finance.purchase_order
         SET finance_status = 'OPEN', challenge_reasons = NULL, challenge_note = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE po_id = $1`, [poId]);
  }
  await audit({ actor, eventType: "purchase_order.resubmit_challenge", objectType: "purchase_order", objectRef: String(poId), detail: { route } });
  return { ok: true, route, status: route === "TO_SIGNOFF" ? "PENDING_SIGNOFF" : "APPROVED", finance_status: "OPEN" };
}

// Clear a challenge / re-open a closed P.O back to OPEN (finance/admin).
export async function reopenFinance(poId, actor) {
  await query(
    `UPDATE finance.purchase_order
       SET finance_status = 'OPEN', challenge_reasons = NULL, challenge_note = NULL,
           closed_by = NULL, closed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE po_id = $1`, [poId]);
  await audit({ actor, eventType: "purchase_order.reopen_finance", objectType: "purchase_order", objectRef: String(poId) });
  return { ok: true, finance_status: "OPEN" };
}

// POs (with their recharge allocation lines) for the Excel export.
export async function posForExport(ids = null) {
  const params = [];
  let where = "";
  if (Array.isArray(ids) && ids.length) { where = `WHERE po_id = ANY($1::bigint[])`; params.push(ids); }
  const { rows: pos } = await query(`SELECT * FROM finance.purchase_order ${where} ORDER BY department, created_at DESC`, params);
  if (!pos.length) return [];
  const { rows: rc } = await query(
    `SELECT po_id, store_code, store_name, pct, amount FROM finance.purchase_order_recharge
     WHERE po_id = ANY($1::bigint[]) ORDER BY store_name`, [pos.map((p) => p.po_id)]);
  const byPo = new Map(pos.map((p) => [p.po_id, { ...p, recharge: [] }]));
  for (const r of rc) byPo.get(r.po_id)?.recharge.push(r);
  return [...byPo.values()];
}
