/*
 * Departmental Budgets — pure rules. No imports, no DB. The grid maths (line
 * totals, monthly column totals, category subtotals, grand total, prior-year
 * variance), the equal-split phasing helper and the DRAFT→SUBMITTED→APPROVED
 * state machine all live here so they are unit-tested independently of the
 * database and the UI. Unit-tested in tests/dept-budget-rules.test.mjs.
 */

// Budget year runs Jan–Dec. m01 = January … m12 = December.
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_KEYS = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"];

export const BUDGET_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED"];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

// Full-year total for one cost line (sum of its 12 months).
export function lineTotal(line = {}) {
  return round2(MONTH_KEYS.reduce((t, k) => t + num(line[k]), 0));
}

// Per-month column totals across all lines — the monthly cash phasing.
export function monthlyTotals(lines = []) {
  return MONTH_KEYS.map((k) => round2(lines.reduce((t, l) => t + num(l[k]), 0)));
}

// Full-year grand total across all lines.
export function grandTotal(lines = []) {
  return round2(lines.reduce((t, l) => t + lineTotal(l), 0));
}

// Prior-year total across all lines.
export function priorYearTotal(lines = []) {
  return round2(lines.reduce((t, l) => t + num(l.prior_year), 0));
}

/*
 * Group lines into categories in first-seen order, each with its own subtotal,
 * monthly phasing and prior-year figure. Drives the grid's category bands.
 */
export function categoryGroups(lines = []) {
  const order = [];
  const map = new Map();
  for (const l of lines) {
    const c = l.category || "General";
    if (!map.has(c)) { map.set(c, []); order.push(c); }
    map.get(c).push(l);
  }
  return order.map((category) => {
    const ls = map.get(category);
    return { category, lines: ls, subtotal: grandTotal(ls), monthly: monthlyTotals(ls), prior: priorYearTotal(ls) };
  });
}

// Variance of a budget figure against prior year. pct is null when prior is nil
// (no meaningful percentage from a zero base).
export function variance(current, prior) {
  const c = num(current), p = num(prior);
  const abs = round2(c - p);
  const pct = p === 0 ? null : round2((abs / Math.abs(p)) * 100);
  return { abs, pct };
}

/*
 * Spread an annual figure evenly across the 12 months, summing to EXACTLY the
 * annual amount (odd pennies go to the earliest months). Returns 12 numbers,
 * m01…m12. Handles negative annuals symmetrically.
 */
export function equalSplit(annual) {
  const cents = Math.round(num(annual) * 100);
  const base = Math.trunc(cents / 12);
  let rem = cents - base * 12;               // signed remainder
  const step = rem < 0 ? -1 : 1;
  rem = Math.abs(rem);
  return MONTH_KEYS.map((_, i) => round2((base + (i < rem ? step : 0)) / 100));
}

// A cost line needs a name; everything else defaults to zero.
export function validateLine(line = {}) {
  if (!line.line_label || !String(line.line_label).trim()) return "Every cost line needs a name";
  return null;
}

export function validateBudget({ department, budget_year } = {}) {
  if (!department || !String(department).trim()) return "Choose a department";
  const y = Number(budget_year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return "Enter a valid budget year";
  return null;
}

// State machine. Sign-off (approve) is gated to the department's approvers in
// the API layer; the transitions themselves are defined and tested here.
export const BUDGET_TRANSITIONS = {
  submit:  { from: ["DRAFT"], to: "SUBMITTED" },
  approve: { from: ["SUBMITTED"], to: "APPROVED" },
  reopen:  { from: ["SUBMITTED", "APPROVED"], to: "DRAFT" },
};

export function budgetTransitionError(action, status) {
  const t = BUDGET_TRANSITIONS[action];
  if (!t) return `Unknown action '${action}'`;
  if (!BUDGET_STATUSES.includes(status)) return `Unknown status '${status}'`;
  if (!t.from.includes(status)) return `Cannot ${action} a budget that is ${status.toLowerCase()}`;
  return null;
}

// Only a DRAFT budget's figures can be edited; submitted/approved are locked
// (reopen to edit again).
export const isEditableBudget = (status) => status === "DRAFT";
