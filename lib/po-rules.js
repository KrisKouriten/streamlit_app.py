/*
 * Purchase Order Tracker — pure rules. No imports, no DB. Field validation, the
 * recharge percentage maths (equal split, 100% check, £ amounts), the marketing
 * levy → invoicing outcome, and the sign-off gate all live here so they are
 * unit-tested independently of the database and the UI. Unit-tested in
 * tests/po-rules.test.mjs.
 */

export const PO_STATUSES = ["DRAFT", "PENDING_SIGNOFF", "APPROVED", "REJECTED", "CANCELLED"];

export const PO_CATEGORIES = [
  "Marketing", "IT & Systems", "Professional Fees", "Facilities & Property",
  "Logistics & Distribution", "Store Operations", "HR & Recruitment", "Travel",
  "Capital Expenditure", "Stock / Merchandise", "Other",
];

export const CURRENCIES = ["GBP", "EUR", "USD", "CNY"];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Validate the P.O header. Returns an error string or null. The P.O number is no
// longer entered — the platform mints a unique one on save (migration 062) — so
// it is not a required input here.
export function validatePo(input = {}) {
  if (!input.po_date) return "Enter the P.O date";
  if (!input.supplier || !String(input.supplier).trim()) return "Enter the supplier";
  if (!input.currency) return "Choose a currency";
  if (input.payment_value == null || String(input.payment_value) === "" || Number(input.payment_value) <= 0) return "Enter a net value greater than zero";
  if (input.fulfilment_days != null && String(input.fulfilment_days) !== "" && (!Number.isFinite(Number(input.fulfilment_days)) || Number(input.fulfilment_days) < 0)) return "Fulfilment period (days) must be zero or more";
  if (!input.po_category) return "Choose a P.O category";
  if (!input.department || !String(input.department).trim()) return "Choose the department";
  if (input.invoice_entity_id == null || String(input.invoice_entity_id) === "") return "Choose the entity to be invoiced";
  return null;
}

// The human-facing reference for a P.O: the app-minted number (migration 062),
// falling back to any legacy Xero number, then the internal id.
export function poRef(po = {}) {
  return po.po_number || po.xero_po_number || (po.po_id != null ? `P.O #${po.po_id}` : "—");
}

// Sum of the recharge percentages, to 2dp.
export function rechargeTotal(lines = []) {
  return round2(lines.reduce((t, l) => t + (Number(l.pct) || 0), 0));
}

// Null when the recharge is valid, else the reason. When recharge is off there
// is nothing to check. A total that isn't 100% (±0.01) blocks sign-off (CR).
export function rechargeError(lines = [], { enabled = true } = {}) {
  if (!enabled) return null;
  if (!lines.length) return "Select at least one store to recharge, or turn recharge off";
  for (const l of lines) {
    if (Number(l.pct) < 0) return "Percentages cannot be negative";
  }
  const total = rechargeTotal(lines);
  if (Math.abs(total - 100) > 0.01) return `Store percentages must total 100% — they currently total ${total}%`;
  return null;
}

// Split 100% evenly across the given stores, summing to EXACTLY 100 (pennies of
// the remainder go to the earliest stores). Percentages are 2dp.
export function equalSplit(stores = []) {
  const n = stores.length;
  if (!n) return [];
  const base = Math.floor(10000 / n);          // basis points
  const rem = 10000 - base * n;
  return stores.map((s, i) => ({ ...(typeof s === "object" ? s : { store_code: s }), pct: round2((base + (i < rem ? 1 : 0)) / 100) }));
}

// Attach the derived £ amount to each recharge line for a given total value.
export function rechargeAmounts(lines = [], totalValue = 0) {
  const v = Number(totalValue) || 0;
  return lines.map((l) => ({ ...l, amount: round2(((Number(l.pct) || 0) / 100) * v) }));
}

// What finance must do with the recharge, driven by the marketing-levy answer.
export function invoiceOutcome({ isMarketing = false, marketingLevy = null, rechargeEnabled = false } = {}) {
  if (isMarketing && marketingLevy === true) return { code: "LEVY_NO_INVOICE", label: "Marketing levy — allocate to stores, no invoice" };
  if (isMarketing && marketingLevy === false) return { code: "FINANCE_TO_INVOICE", label: "Marketing (non-levy) — finance to issue an invoice" };
  if (rechargeEnabled) return { code: "STANDARD", label: "Standard store recharge" };
  return { code: "NONE", label: "No recharge" };
}

// The gate before a P.O can be submitted for department-head sign-off.
// Returns an error string or null.
export function canSubmitForSignoff(po = {}, lines = []) {
  const err = validatePo(po);
  if (err) return err;
  if (po.is_marketing && (po.marketing_levy === null || po.marketing_levy === undefined)) {
    return "For marketing spend, state whether it is part of the marketing levy";
  }
  if (po.recharge_enabled && !po.recharge_ho_only) {
    // Head-Office-only recharge allocates 100% to HO, so no store split is needed.
    const r = rechargeError(lines, { enabled: true });
    if (r) return r;
  }
  return null;
}

// The single recharge line for a Head-Office-only allocation.
export function headOfficeLine() {
  return { store_code: "HO", store_name: "Head Office", pct: 100 };
}

// Lifecycle transitions. Department-head sign-off (approve/reject) will be wired
// to user-controls later; the transitions are defined here so the machine is
// complete and testable.
export const PO_TRANSITIONS = {
  submit_for_signoff: { from: ["DRAFT", "REJECTED"], to: "PENDING_SIGNOFF" },
  return_to_draft:    { from: ["PENDING_SIGNOFF"], to: "DRAFT" },
  approve:            { from: ["PENDING_SIGNOFF"], to: "APPROVED" },
  reject:             { from: ["PENDING_SIGNOFF"], to: "REJECTED" },
  cancel:             { from: ["DRAFT", "PENDING_SIGNOFF", "REJECTED"], to: "CANCELLED" },
};

export function poTransitionError(action, status) {
  const t = PO_TRANSITIONS[action];
  if (!t) return `Unknown action '${action}'`;
  if (!PO_STATUSES.includes(status)) return `Unknown status '${status}'`;
  if (!t.from.includes(status)) return `Cannot ${action.replace(/_/g, " ")} a P.O that is ${status.replace(/_/g, " ").toLowerCase()}`;
  return null;
}

export const isEditablePo = (status) => status === "DRAFT" || status === "REJECTED";

// The submitter can edit a P.O that is a draft, was rejected at sign-off, or has
// been CHALLENGED by Finance (signed off, but sent back for changes). Takes the
// whole row so it can consult the finance lifecycle.
export function canEditPo(po = {}) {
  if (isEditablePo(po.status)) return true;
  return po.status === "APPROVED" && po.finance_status === "CHALLENGED";
}
// Is this P.O currently challenged and awaiting the submitter's edit + resubmit?
export const isChallenged = (po = {}) => po.status === "APPROVED" && po.finance_status === "CHALLENGED";

// ---- Finance close / challenge (the P.O Summary + Close stage) ----

// The finance lifecycle, which sits on top of an APPROVED (signed-off) request.
export const FINANCE_STATUSES = ["OPEN", "CHALLENGED", "CLOSED"];

// ---- Payment status (maintained by Finance on P.O Summary + Close) ----
// Whether the supplier has actually been paid — distinct from the finance
// lifecycle (Open/Challenged/Closed). Departments see this on their dashboard.
export const PAYMENT_STATUSES = [
  { code: "UNPAID", label: "Unpaid", tone: "muted" },
  { code: "PART_PAID", label: "Part-paid", tone: "amber" },
  { code: "PAID", label: "Paid", tone: "green" },
];
const PAYMENT_LABEL = Object.fromEntries(PAYMENT_STATUSES.map((p) => [p.code, p]));
export function paymentStatusOf(po = {}) {
  return PAYMENT_LABEL[po.payment_status] || PAYMENT_LABEL.UNPAID;
}
export const isPaymentStatus = (code) => PAYMENT_STATUSES.some((p) => p.code === code);

// ---- Multiple invoices per P.O (migration 099) ----
// A P.O can carry several supplier invoices, each with its own paid state. These
// pure helpers roll the invoice rows up to a total and a payment status so the
// Part-paid state reflects how much has actually been paid.

// Validate one invoice line. Returns an error string or null.
export function validatePoInvoice(input = {}) {
  if (!input.invoice_number || !String(input.invoice_number).trim()) return "Enter the invoice number";
  const amt = input.invoice_amount;
  if (amt == null || String(amt) === "" || !Number.isFinite(Number(amt)) || Number(amt) <= 0) return "Enter an invoice amount greater than zero";
  return null;
}

// Totals across a P.O's invoices: count, total invoiced, total paid, outstanding.
export function invoiceTotals(invoices = []) {
  const list = Array.isArray(invoices) ? invoices : [];
  const total = round2(list.reduce((t, i) => t + (Number(i.invoice_amount) || 0), 0));
  const paid = round2(list.filter((i) => i.paid).reduce((t, i) => t + (Number(i.invoice_amount) || 0), 0));
  return { count: list.length, total, paid, outstanding: round2(total - paid), paidCount: list.filter((i) => i.paid).length };
}

// The payment status derived from the invoices, measured against the P.O value:
//   UNPAID     nothing paid yet
//   PAID       the paid invoices cover the P.O value (fully settled)
//   PART_PAID  something is paid but it doesn't yet cover the P.O value —
//              e.g. one invoice paid against a larger P.O, or an unpaid invoice
// Returns null when there are no invoices (the manual status then applies).
// When no P.O value is supplied it falls back to "every invoice paid" = PAID.
export function derivePaymentStatus(invoices = [], poValue = null) {
  const list = Array.isArray(invoices) ? invoices : [];
  if (!list.length) return null;
  const { paid } = invoiceTotals(list);
  if (paid <= 0.01) return "UNPAID";
  const pv = Number(poValue);
  if (Number.isFinite(pv) && pv > 0) return paid + 0.01 >= pv ? "PAID" : "PART_PAID";
  return list.every((i) => i.paid) ? "PAID" : "PART_PAID";
}

// Does the invoiced total reconcile with the P.O net value (within 1p)?
export function invoicesReconcile(invoices = [], poValue = 0) {
  const { total } = invoiceTotals(invoices);
  return Math.abs(total - (Number(poValue) || 0)) <= 0.01;
}

// A short reference for the parent row when there are several invoices:
// "INV-1" or "INV-1 +2".
export function invoiceSummaryRef(invoices = []) {
  const list = Array.isArray(invoices) ? invoices : [];
  const nums = list.map((i) => i.invoice_number).filter(Boolean);
  if (!nums.length) return null;
  return nums.length === 1 ? nums[0] : `${nums[0]} +${nums.length - 1}`;
}

// ---- Self sign-off ----
// A P.O whose net value is within the org self-approval limit can be signed off
// by its own creator (no department-head approver needed), so small P.Os don't
// queue for sign-off. A limit of 0 (or blank) turns the feature off — every P.O
// then needs a department-head sign-off. Returns a boolean.
export function selfApproveAllowed({ value, limit } = {}) {
  const lim = Number(limit) || 0;
  const val = Number(value) || 0;
  return lim > 0 && val > 0 && val <= lim;
}

// ---- Department self-approval policy (migration 063) ----
// A per-department control that gates self-approval on the FIRST limit reached:
// a count of self-approved P.Os per period, an individual-P.O value cap, or a
// cumulative value cap — whichever binds first. The measurement period and the
// cancelled-P.O counting policy are configurable. When a department has no policy
// the org-wide self-approval limit (value only) applies, preserving legacy
// behaviour.

export const MEASUREMENT_PERIODS = [
  { code: "CALENDAR_MONTH", label: "Calendar month" },
  { code: "FINANCIAL_PERIOD", label: "Financial period (month)" },
  { code: "CALENDAR_QUARTER", label: "Calendar quarter" },
  { code: "FINANCIAL_YEAR", label: "Financial year" },
  { code: "ROLLING_30_DAYS", label: "Rolling 30 days" },
  { code: "CUSTOM_PERIOD", label: "Custom period (days)" },
];
export const isMeasurementPeriod = (code) => MEASUREMENT_PERIODS.some((p) => p.code === code);

export const CANCELLED_PO_POLICIES = [
  { code: "RETAIN_IN_COUNT", label: "Keep cancelled P.Os in the count (cancelling does not restore capacity)" },
  { code: "REMOVE_FROM_COUNT", label: "Remove cancelled P.Os from the count" },
];

export const PO_APPROVAL_ROUTES = { SELF: "SELF_APPROVED", DEPT: "DEPT_SIGNOFF", MANAGER: "LINE_MANAGER" };

// Only signed-off (APPROVED) P.Os consume self-approval capacity. Drafts, rejected
// and test/void records never count. Cancelled P.Os are handled by the department's
// cancelled_po_policy in the counting query (RETAIN keeps a once-approved-then-
// cancelled P.O in the count so cancelling cannot regain capacity).
export const SELF_APPROVE_COUNTABLE_STATUSES = ["APPROVED"];

// Validate a department policy before it is saved. Returns an error string or null.
export function validateDeptPoPolicy(p = {}) {
  if (!p.department || !String(p.department).trim()) return "Choose the department";
  if (!isMeasurementPeriod(p.measurement_period || "FINANCIAL_PERIOD")) return "Choose a valid measurement period";
  const nonNeg = (v, label) => (v != null && v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0) ? `${label} must be zero or more` : null);
  for (const [v, label] of [
    [p.count_limit, "Self-approved P.O count limit"],
    [p.max_individual_value, "Maximum individual value"],
    [p.max_cumulative_value, "Maximum cumulative value"],
    [p.custom_period_days, "Custom period (days)"],
  ]) {
    const e = nonNeg(v, label);
    if (e) return e;
  }
  if (p.measurement_period === "CUSTOM_PERIOD" && !(Number(p.custom_period_days) > 0)) {
    return "Enter the custom period length in days";
  }
  if (p.cancelled_po_policy && !CANCELLED_PO_POLICIES.some((c) => c.code === p.cancelled_po_policy)) {
    return "Choose a valid cancelled-P.O counting policy";
  }
  return null;
}

// The self-approval decision for a P.O about to be submitted. Pure: the caller
// supplies the department policy, the period usage (count + cumulative value
// already consumed), the org-wide fallback limit, and any EXTRA blocking reasons
// already determined elsewhere (user approval limit exceeded, department/project
// budget insufficient, supplier requires enhanced approval, segregation-of-duties
// breach). The outcome always reflects the MOST RESTRICTIVE applicable rule.
//
// Returns:
//   { selfApprove, route, reasons[], binding, usedCount, usedValue, countLimit,
//     maxIndividual, maxCumulative, remainingCount, remainingValue, projectedValue }
export function selfApprovalDecision({ value, policy, usage, orgLimit, blocks } = {}) {
  const val = Number(value) || 0;
  const extra = (Array.isArray(blocks) ? blocks : []).map((b) => String(b)).filter(Boolean);

  // No (or inactive) department policy → org-wide value-only self-approval limit.
  if (!policy || policy.active === false) {
    const allowed = selfApproveAllowed({ value: val, limit: orgLimit }) && extra.length === 0;
    const reasons = [...extra];
    if (!allowed && !selfApproveAllowed({ value: val, limit: orgLimit })) {
      reasons.unshift(
        Number(orgLimit) > 0
          ? `This P.O (${val}) is above the £${Number(orgLimit)} self-approval limit — department sign-off required`
          : "Self-approval is off — department sign-off required"
      );
    }
    return {
      selfApprove: allowed,
      route: allowed ? PO_APPROVAL_ROUTES.SELF : PO_APPROVAL_ROUTES.DEPT,
      reasons,
      binding: reasons[0] || null,
      usedCount: null, usedValue: null, countLimit: null,
      maxIndividual: Number(orgLimit) > 0 ? Number(orgLimit) : null, maxCumulative: null,
      remainingCount: null, remainingValue: null, projectedValue: val,
    };
  }

  const usedCount = Number(usage?.count) || 0;
  const usedValue = Number(usage?.cumulativeValue) || 0;
  const countLimit = policy.count_limit == null || policy.count_limit === "" ? null : Number(policy.count_limit);
  const maxInd = policy.max_individual_value == null || policy.max_individual_value === "" ? null : Number(policy.max_individual_value);
  const maxCum = policy.max_cumulative_value == null || policy.max_cumulative_value === "" ? null : Number(policy.max_cumulative_value);
  const projectedValue = round2(usedValue + val);

  const reasons = [];
  if (val <= 0) reasons.push("Enter a net value greater than zero");
  if (countLimit != null && usedCount >= countLimit) {
    reasons.push(`The department has used all ${countLimit} self-approved P.Os this period`);
  }
  if (maxInd != null && val > maxInd) {
    reasons.push(`This P.O (${round2(val)}) exceeds the individual self-approval limit (${maxInd})`);
  }
  if (maxCum != null && projectedValue > maxCum) {
    reasons.push(`This P.O would take cumulative self-approved value (${projectedValue}) over the department limit (${maxCum})`);
  }
  // Cross-cutting blocks always defer to sign-off.
  for (const b of extra) reasons.push(b);

  const selfApprove = reasons.length === 0;
  const route = selfApprove
    ? PO_APPROVAL_ROUTES.SELF
    : (policy.line_manager_email ? PO_APPROVAL_ROUTES.MANAGER : PO_APPROVAL_ROUTES.DEPT);

  return {
    selfApprove,
    route,
    reasons,
    binding: reasons[0] || null,
    usedCount,
    usedValue: round2(usedValue),
    countLimit,
    maxIndividual: maxInd,
    maxCumulative: maxCum,
    remainingCount: countLimit == null ? null : Math.max(0, countLimit - usedCount),
    remainingValue: maxCum == null ? null : round2(Math.max(0, maxCum - usedValue)),
    projectedValue,
  };
}

// The controlled reasons Finance can raise a challenge under. "Other" keeps it
// open — a free-text note is required whenever it is chosen.
export const CHALLENGE_REASONS = [
  { code: "INVOICE_VALUE", label: "Invoice value — different to the P.O" },
  { code: "PO_DETAILS", label: "P.O details — discrepancies vs the invoice" },
  { code: "PO_ALLOCATION", label: "P.O allocation — requires further questions" },
  { code: "SPEND_VS_BUDGET", label: "Spend vs budget — requires further questions" },
  { code: "OTHER", label: "Other — see note" },
];
const REASON_LABEL = Object.fromEntries(CHALLENGE_REASONS.map((r) => [r.code, r.label]));
export function challengeReasonLabels(codes = []) {
  return (Array.isArray(codes) ? codes : String(codes || "").split(",")).map((c) => String(c).trim()).filter(Boolean).map((c) => REASON_LABEL[c] || c);
}
export const isChallengeReason = (code) => CHALLENGE_REASONS.some((r) => r.code === code);

// Where a challenged P.O goes once the submitter has edited it — Finance chooses
// per challenge. TO_FINANCE returns it straight to Finance (re-review, no fresh
// sign-off, since the department already signed it off); TO_SIGNOFF sends it back
// through department sign-off first.
export const CHALLENGE_RETURN_ROUTES = [
  { code: "TO_FINANCE", label: "Back to Finance after the fix" },
  { code: "TO_SIGNOFF", label: "Back for department sign-off, then Finance" },
];
export const isChallengeReturnRoute = (code) => CHALLENGE_RETURN_ROUTES.some((r) => r.code === code);
export const DEFAULT_CHALLENGE_RETURN_ROUTE = "TO_FINANCE";

// "Other" requires a note explaining the query.
export const challengeNoteRequired = (reasons = []) =>
  (Array.isArray(reasons) ? reasons : String(reasons || "").split(",")).map((c) => String(c).trim()).includes("OTHER");

// Validate a challenge before it is raised. Returns an error string or null.
export function challengeValidationError({ reasons = [], note = null, returnRoute = null } = {}) {
  const codes = (Array.isArray(reasons) ? reasons : String(reasons || "").split(",")).map((c) => String(c).trim()).filter(Boolean);
  if (!codes.length) return "Choose at least one challenge reason";
  for (const c of codes) if (!isChallengeReason(c)) return `Unknown challenge reason '${c}'`;
  if (challengeNoteRequired(codes) && !String(note || "").trim()) return "Add a note explaining the ‘Other’ reason";
  if (returnRoute != null && returnRoute !== "" && !isChallengeReturnRoute(returnRoute)) return "Choose a valid return route";
  return null;
}

// "Signed off by the head of department" = the request reached APPROVED.
export const isSignedOff = (po = {}) => po.status === "APPROVED";

/*
 * The single status shown against a P.O on Purchase Order Requests. Before sign-off
 * it reflects the request lifecycle; once signed off it reflects the FINANCE
 * lifecycle (Open / Challenged / Closed) which is what Finance drives.
 */
export function displayStatus(po = {}) {
  if (po.status === "CANCELLED") return { code: "CANCELLED", label: "Cancelled", tone: "muted" };
  if (po.status === "DRAFT") return { code: "DRAFT", label: "Draft", tone: "muted" };
  if (po.status === "REJECTED") return { code: "REJECTED", label: "Rejected", tone: "red" };
  if (po.status === "PENDING_SIGNOFF") return { code: "PENDING_SIGNOFF", label: "Awaiting sign-off", tone: "amber" };
  // APPROVED → finance lifecycle
  if (po.finance_status === "CLOSED") return { code: "CLOSED", label: "Closed", tone: "green" };
  if (po.finance_status === "CHALLENGED") return { code: "CHALLENGED", label: "Challenged", tone: "red" };
  return { code: "OPEN", label: "Open", tone: "accent" };
}

/*
 * Deletion rule: before a P.O is signed off (head of department), the requester or
 * an admin can delete it; once signed off, only an admin can. Returns
 * { ok, reason }.
 */
export function canDeletePo(po = {}, { isAdmin = false } = {}) {
  if (isAdmin) return { ok: true };
  if (isSignedOff(po) || po.finance_status === "CLOSED" || po.finance_status === "CHALLENGED") {
    return { ok: false, reason: "Signed-off P.Os can only be deleted by an admin" };
  }
  return { ok: true };
}

// Finance transitions must act on a signed-off (APPROVED) P.O.
export function financeActionError(action, po = {}) {
  if (!isSignedOff(po)) return "This P.O has not been signed off yet";
  if (action === "close" && po.finance_status === "CLOSED") return "This P.O is already closed";
  return null;
}

// The £ that a CLOSED P.O commits — the invoice net amount if entered, else the
// P.O net value.
export function committedAmount(po = {}) {
  const inv = po.invoice_amount;
  return inv != null && inv !== "" ? Number(inv) || 0 : Number(po.payment_value) || 0;
}

// ---- Due date + payment terms ----

// The number of days in a payment-terms string. Accepts "30", "30 days",
// "Net 30", "net-45" etc. Returns null when there is no number to work with.
export function termDaysFrom(paymentTerms) {
  if (paymentTerms == null) return null;
  const m = String(paymentTerms).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// The due date = P.O date + payment-term days, as an ISO yyyy-mm-dd string.
// Returns null when either input is missing/invalid. Date-only maths (UTC) so it
// never shifts across a timezone boundary.
export function dueDateFrom(poDateISO, termDays) {
  if (!poDateISO || termDays == null || !Number.isFinite(Number(termDays))) return null;
  const base = new Date(`${String(poDateISO).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(termDays));
  return base.toISOString().slice(0, 10);
}

/*
 * The parts of the marketing budget a P.O can be tagged against — the "budget
 * link" list shown only when the department is Marketing. Business language that
 * maps onto the departmental-budget initiatives (campaigns / projects / store
 * openings). "Other" keeps it open.
 */
export const MARKETING_BUDGET_LINKS = [
  "Campaign costs",
  "One-off projects",
  "New store openings",
  "BAU / recurring",
  "Other",
];

// ---- P.O audit trail (read-only, migration-free) ----
// Every P.O lifecycle event is written to governance.audit_event with
// event_type "purchase_order.<action>". describePoAuditEvent turns one such row
// into a human timeline entry: a short label, an optional detail line and a tone
// so the P.O Summary & Close page can show who did what and when — the P.O was
// raised, self/line-manager/finance approvals, challenges, reissues and every
// update to the record.

// The approval routes as they read to a person, keyed by the stored route code.
const APPROVAL_ROUTE_LABEL = {
  SELF_APPROVED: "self-approved",
  LINE_MANAGER: "line manager",
  DEPT_SIGNOFF: "department sign-off",
};
const approvalRouteLabel = (code) => APPROVAL_ROUTE_LABEL[code] || (code ? String(code).toLowerCase().replace(/_/g, " ") : null);

// The friendly name for a stored update field (detail.fields) so "Updated" lines
// read in business terms rather than column names.
const PO_FIELD_LABEL = {
  supplier: "supplier", payment_value: "value", currency: "currency",
  payment_terms: "payment terms", payment_date: "due date", po_date: "P.O date",
  po_category: "category", department: "department", notes: "notes",
  invoice_number: "invoice no", invoice_amount: "invoice value",
  fulfilment_start_date: "fulfilment start", fulfilment_days: "fulfilment days",
  is_marketing: "marketing flag", marketing_levy: "marketing levy",
  marketing_budget_category: "budget link", marketing_campaign: "campaign",
  business_project_id: "project", recharge: "recharge allocation",
};
const fieldLabels = (fields = []) =>
  (Array.isArray(fields) ? fields : []).map((f) => PO_FIELD_LABEL[f] || String(f).replace(/_/g, " ")).filter(Boolean);

// event_type suffix -> { label, tone } and an optional detail() builder. Tone is
// a semantic hint the UI maps to a colour (accent = milestone, green = approved/
// closed, red = challenged/rejected, muted = routine edit).
export function describePoAuditEvent(event = {}) {
  const type = String(event.event_type || event.eventType || "");
  const action = type.startsWith("purchase_order.") ? type.slice("purchase_order.".length) : type;
  const d = event.detail || {};
  let label = null;
  let tone = "muted";
  let detail = null;

  switch (action) {
    case "create":
      label = "P.O raised"; tone = "accent";
      detail = d.po_number ? `Reference ${d.po_number}` : null;
      break;
    case "self_approve":
      label = "Self-approved"; tone = "green";
      break;
    case "submit_for_signoff": {
      const route = approvalRouteLabel(d.route);
      label = "Sent for sign-off"; tone = "accent";
      detail = route ? `Routed to ${route}` : null;
      break;
    }
    case "override_route": {
      const from = approvalRouteLabel(d.original);
      const to = approvalRouteLabel(d.revised);
      label = "Approval route overridden"; tone = "accent";
      detail = [from && to ? `${from} → ${to}` : to ? `Set to ${to}` : null, d.reason ? `“${d.reason}”` : null].filter(Boolean).join(" · ") || null;
      break;
    }
    case "approve":
      label = "Approved"; tone = "green";
      break;
    case "reject":
      label = "Rejected"; tone = "red";
      break;
    case "return_to_draft":
      label = "Returned to draft"; tone = "muted";
      break;
    case "challenge": {
      label = "Challenged by Finance"; tone = "red";
      const reasons = challengeReasonLabels(d.reasons);
      detail = reasons.length ? reasons.join(" · ") : null;
      break;
    }
    case "resubmit_challenge":
      label = "Reissued after challenge"; tone = "accent";
      break;
    case "reopen_finance":
      label = "Re-opened by Finance"; tone = "amber";
      break;
    case "close":
      label = "Closed by Finance"; tone = "green";
      break;
    case "update": {
      const fields = fieldLabels(d.fields);
      label = "Record updated"; tone = "muted";
      detail = fields.length ? `Changed ${fields.join(", ")}` : null;
      break;
    }
    case "invoice_add":
      label = "Invoice added"; tone = "muted";
      detail = [d.invoice_number ? d.invoice_number : null, d.paid ? "paid" : null].filter(Boolean).join(" · ") || null;
      break;
    case "invoice_update":
      label = "Invoice updated"; tone = "muted";
      break;
    case "invoice_delete":
      label = "Invoice removed"; tone = "muted";
      break;
    case "set_invoice":
      label = "Invoice recorded"; tone = "muted";
      detail = d.invoice_number || null;
      break;
    case "set_payment_status":
      label = "Payment status updated"; tone = "muted";
      detail = d.payment_status ? String(d.payment_status).replace(/_/g, " ").toLowerCase() : null;
      break;
    case "delete":
      label = "P.O deleted"; tone = "red";
      break;
    default:
      label = action ? action.replace(/_/g, " ") : "Event"; tone = "muted";
  }

  const actor = event.actor_name || event.actor_email || null;
  return { action, label, tone, detail, actor, at: event.occurred_at || null };
}
