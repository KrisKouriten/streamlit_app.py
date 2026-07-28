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

// Validate the P.O header. Returns an error string or null.
export function validatePo(input = {}) {
  if (!input.po_date) return "Enter the P.O date";
  if (!input.supplier || !String(input.supplier).trim()) return "Enter the supplier";
  if (!input.currency) return "Choose a currency";
  if (input.payment_value == null || String(input.payment_value) === "" || Number(input.payment_value) <= 0) return "Enter a net value greater than zero";
  if (input.fulfilment_days != null && String(input.fulfilment_days) !== "" && (!Number.isFinite(Number(input.fulfilment_days)) || Number(input.fulfilment_days) < 0)) return "Fulfilment period (days) must be zero or more";
  if (!input.po_category) return "Choose a P.O category";
  if (!input.xero_po_number || !String(input.xero_po_number).trim()) return "Enter the Xero P.O number — generate it in Xero first";
  if (!input.department || !String(input.department).trim()) return "Choose the department";
  return null;
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
