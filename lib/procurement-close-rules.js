/*
 * Procurement Summary + Close — pure rules (no imports, no DB). Mirrors the P.O
 * finance lifecycle (lib/po-rules.js) for procurement purchases: Finance approves
 * a purchase, may challenge it with reasons, records the invoice + payment status,
 * then closes it. Applies to every row in finance.procurement_purchase — both the
 * cash-tracker purchases (Miniso / Local) and the OTB-linked merch requests.
 * Unit-tested in tests/procurement-close-rules.test.mjs.
 */

// The finance lifecycle: PENDING → APPROVED → (CHALLENGED) → CLOSED.
export const PROC_FINANCE_STATUSES = ["PENDING", "APPROVED", "CHALLENGED", "CLOSED"];

export const PROC_CHALLENGE_REASONS = [
  { code: "INVOICE_VALUE", label: "Invoice value" },
  { code: "SUPPLIER_TERMS", label: "Supplier terms" },
  { code: "LANDED_COST", label: "Landed cost" },
  { code: "SPEND_VS_BUDGET", label: "Spend vs budget" },
  { code: "OTB_EXCEEDED", label: "OTB exceeded" },
];
const CH_LABEL = Object.fromEntries(PROC_CHALLENGE_REASONS.map((r) => [r.code, r.label]));
export function challengeReasonLabels(joined) {
  return String(joined || "").split(",").map((c) => c.trim()).filter(Boolean).map((c) => CH_LABEL[c] || c);
}
export const isProcChallengeReason = (code) => PROC_CHALLENGE_REASONS.some((r) => r.code === code);

// Payment status (mirrors P.O). The DB layer keeps the base status column
// (COMMITTED/PAID) in step with this.
export const PROC_PAYMENT_STATUSES = [
  { code: "UNPAID", label: "Unpaid", tone: "muted" },
  { code: "PART_PAID", label: "Part-paid", tone: "amber" },
  { code: "PAID", label: "Paid", tone: "green" },
];
const PAY_LABEL = Object.fromEntries(PROC_PAYMENT_STATUSES.map((p) => [p.code, p]));
export function paymentStatusOf(row = {}) { return PAY_LABEL[row.payment_status] || PAY_LABEL.UNPAID; }
export const isProcPaymentStatus = (code) => PROC_PAYMENT_STATUSES.some((p) => p.code === code);

const financeStatus = (row = {}) => row.finance_status || "PENDING";

// The finance-action gate — which action is allowed from which status.
export function financeActionError(action, row = {}) {
  const st = financeStatus(row);
  if (action === "approve") return st === "PENDING" ? null : "This purchase has already been approved";
  if (action === "challenge") {
    if (st === "PENDING") return "Approve the purchase before challenging it";
    if (st === "CLOSED") return "This purchase is closed — re-open it first";
    return null;
  }
  if (action === "close") {
    if (st === "PENDING") return "Approve the purchase before closing it";
    if (st === "CLOSED") return "This purchase is already closed";
    return null;
  }
  if (action === "reopen") return (st === "CHALLENGED" || st === "CLOSED") ? null : "Nothing to re-open on this purchase";
  if (action === "invoice" || action === "payment") return st === "PENDING" ? "Approve the purchase first" : null;
  return null;
}

// The status shown on the desk + dashboard.
export function displayStatus(row = {}) {
  const st = financeStatus(row);
  if (st === "CLOSED") return { label: "Closed", tone: "green" };
  if (st === "CHALLENGED") return { label: "Challenged", tone: "red" };
  if (st === "APPROVED") return { label: "Approved", tone: "accent" };
  return { label: "Pending", tone: "amber" };
}

const num = (v) => Number(v) || 0;

// The net value of a purchase — landed cost where known (merch requests), else the
// order amount (cash-tracker rows).
export function lineValue(row = {}) {
  return row.landed_cost != null && num(row.landed_cost) > 0 ? num(row.landed_cost) : num(row.amount_gbp);
}
// The committed amount once closed — invoice net where recorded, else the line value.
export function committedAmount(row = {}) {
  return row.invoice_amount != null ? num(row.invoice_amount) : lineValue(row);
}

// A human reference for a procurement line.
export function procRef(row = {}) {
  if (row.reference) return row.reference;
  return (row.channel_code ? "MR-" : "PP-") + (row.purchase_id != null ? row.purchase_id : "?");
}

// A merch (OTB-linked) request, versus a cash-tracker purchase.
export const isMerchRequest = (row = {}) => !!row.channel_code;
