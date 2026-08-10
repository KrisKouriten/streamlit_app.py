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
  if (action === "challenge") return st === "CLOSED" ? "This purchase is closed — re-open it first" : null;
  if (action === "close") {
    if (st === "PENDING") return "Approve the purchase before closing it";
    if (st === "CLOSED") return "This purchase is already closed";
    return null;
  }
  if (action === "reopen") return (st === "CHALLENGED" || st === "CLOSED") ? null : "Nothing to re-open on this purchase";
  if (action === "invoice" || action === "payment") return st === "PENDING" ? "Approve the purchase first" : null;
  return null;
}

// ---- Letter-of-Credit settlement (Miniso HQ) ----
// Miniso HQ inventory settles by HSBC LC, not a plain invoice: Finance logs the LC
// once confirmed, then reconciles the payment once it settles. Local Purchase uses
// the standard invoice/payment flow instead.
export const LC_BANK_DEFAULT = "HSBC";
export function settlesByLc(row = {}) { return row.source === "MINISO"; }
export function lcStatus(row = {}) {
  if (!settlesByLc(row)) return null;
  if (row.lc_settled) return { label: "LC settled", tone: "green" };
  if (row.lc_reference) return { label: "LC confirmed", tone: "accent" };
  return { label: "LC pending", tone: "amber" };
}
// ---- Documentary Credit (DC) drawdown (migration 093) ----
// A request's LCs group under their DC reference; each DC carries a value, and
// its LCs draw against it. "Used" is the LC-amount-logged basis (every logged
// LC counts against the DC, whether or not it has settled yet).
export const normDcRef = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Roll a request's LCs up against its DC records. Returns one group per DC
// (value, used, settled, remaining, utilisation), newest DCs preserving input
// order, plus a trailing "ungrouped" group for LCs whose dc_reference matches no
// DC record (or is blank). Pure — takes plain arrays, returns plain data.
export function dcDrawdown(dcs = [], lcs = []) {
  const byRef = new Map();
  const groups = [];
  for (const d of dcs) {
    const key = normDcRef(d.dc_reference);
    const g = {
      dc_id: d.dc_id ?? null,
      dc_reference: d.dc_reference || "",
      dc_value: d.dc_value == null ? null : Number(d.dc_value),
      used: 0, settled: 0, count: 0, lcs: [],
    };
    byRef.set(key, g);
    groups.push(g);
  }
  const ungrouped = { dc_id: null, dc_reference: "", dc_value: null, used: 0, settled: 0, count: 0, lcs: [], ungrouped: true };
  for (const l of lcs) {
    const g = byRef.get(normDcRef(l.dc_reference)) || ungrouped;
    g.count += 1;
    g.used += Number(l.lc_amount) || 0;
    if (l.lc_settled) g.settled += Number(l.lc_settled_amount != null ? l.lc_settled_amount : l.lc_amount) || 0;
    g.lcs.push(l);
  }
  const finish = (g) => {
    g.used = round2(g.used); g.settled = round2(g.settled);
    g.remaining = g.dc_value == null ? null : round2(g.dc_value - g.used);
    g.utilisation = g.dc_value ? g.used / g.dc_value : null;
    g.over = g.remaining != null && g.remaining < -0.005;
    return g;
  };
  const out = groups.map(finish);
  if (ungrouped.count) out.push(finish(ungrouped));
  return out;
}

// Validate + clean a DC record from a form/API body.
export function validateDc(input = {}) {
  const errors = [];
  const dc_reference = String(input.dc_reference || "").trim().replace(/\s+/g, " ");
  if (!dc_reference) errors.push("DC reference is required");
  let dc_value = null;
  if (input.dc_value != null && input.dc_value !== "") {
    const n = Number(input.dc_value);
    if (!Number.isFinite(n) || n < 0) errors.push("DC value must be a positive amount (or blank)");
    else dc_value = round2(n);
  }
  return { errors, clean: { dc_reference, dc_value, notes: String(input.notes || "").trim() || null } };
}

// Gate for the LC actions ("log-lc" records/updates the LC; "reconcile-lc" marks it settled).
export function lcActionError(action, row = {}) {
  if (!settlesByLc(row)) return "This purchase is not settled by Letter of Credit";
  if ((row.finance_status || "PENDING") === "PENDING") return "Approve the purchase before recording the LC";
  if (action === "log-lc") return row.lc_settled ? "This LC has already settled" : null;
  if (action === "reconcile-lc") {
    if (!row.lc_reference) return "Log the LC details first";
    if (row.lc_settled) return "This LC has already been reconciled";
    return null;
  }
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

// Foreign-currency FX (migration 085). A row is foreign when its currency is set
// and not GBP; the original-currency amount, the GBP stock valuation booked at
// the costing rate, and the FX gain/loss to P&L (stock valuation − cash cost).
export function isForeignRow(row = {}) {
  const c = String(row.currency || "GBP").toUpperCase();
  return c !== "" && c !== "GBP";
}
// The inventory value booked to closing stock — the arrival valuation at the
// chosen (costing) rate. Null when not yet valued (e.g. a GBP row, or not approved).
export function stockValue(row = {}) {
  return row.stock_value_gbp != null ? num(row.stock_value_gbp) : null;
}
// FX gain/loss to the P&L = inventory value (costing) − cash cost (amount_gbp).
// +ve = stock valued above what we pay. Null unless both figures exist.
export function fxToPL(row = {}) {
  if (row.stock_value_gbp == null || row.amount_gbp == null) return null;
  return num(row.stock_value_gbp) - num(row.amount_gbp);
}
// The £ inventory value at the costing FX rate — what the stock is worth on the
// books. For a foreign order it's the original-currency amount converted at the
// COSTING rate (costingRate is quoted foreign-per-£1, so £ = amount_ccy / rate);
// for a GBP order it's simply the GBP value. Falls back to a booked stock
// valuation, then the GBP cash value, so the column always shows a figure.
export function inventoryCostFx(row = {}, costingRate = null) {
  if (!isForeignRow(row)) return row.amount_gbp != null ? num(row.amount_gbp) : null;
  const cr = Number(costingRate);
  if (Number.isFinite(cr) && cr > 0 && row.amount_ccy != null) return num(row.amount_ccy) / cr;
  if (row.stock_value_gbp != null) return num(row.stock_value_gbp);
  return row.amount_gbp != null ? num(row.amount_gbp) : null;
}

// FX reporting basis (migration 091): which USD→GBP rate the REPORTED GBP value
// uses on the Procurement / Merchandising views — SPOT (default) or HEDGED. This
// is independent of the cash-cost rate and the costing-FX stock valuation.
export const REPORT_RATE_TYPES = ["SPOT", "HEDGED"];
export function reportBasis(row = {}) {
  const b = String(row.report_rate_type || "SPOT").toUpperCase();
  return REPORT_RATE_TYPES.includes(b) ? b : "SPOT";
}
// The reported GBP for a row at its reporting basis. `rate` is the applicable
// foreign-per-£1 rate (SPOT or HEDGED) for the row's currency, resolved by the
// caller. GBP orders return amount_gbp; a foreign order with a rate returns
// amount_ccy / rate; falls back to amount_gbp when no rate/amount_ccy.
export function reportedGbp(row = {}, rate = null) {
  if (!isForeignRow(row)) return row.amount_gbp != null ? num(row.amount_gbp) : null;
  const r = Number(rate);
  if (Number.isFinite(r) && r > 0 && row.amount_ccy != null) return num(row.amount_ccy) / r;
  return row.amount_gbp != null ? num(row.amount_gbp) : null;
}

// A human reference for a procurement line.
export function procRef(row = {}) {
  if (row.reference) return row.reference;
  return (row.channel_code ? "MR-" : "PP-") + (row.purchase_id != null ? row.purchase_id : "?");
}

// A merch (OTB-linked) request, versus a cash-tracker purchase.
export const isMerchRequest = (row = {}) => !!row.channel_code;
