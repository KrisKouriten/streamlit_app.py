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

// The approval chain. A budget flows DRAFT → FINANCE_REVIEW → DEPT_APPROVAL →
// SLT_APPROVAL → LOCKED, and can be returned to DRAFT at any review stage.
export const BUDGET_STAGES = ["DRAFT", "FINANCE_REVIEW", "DEPT_APPROVAL", "SLT_APPROVAL", "LOCKED"];
export const STAGE_LABEL = {
  DRAFT: "Draft", FINANCE_REVIEW: "Finance Review", DEPT_APPROVAL: "Department Approval",
  SLT_APPROVAL: "SLT Approval", LOCKED: "Locked",
};
// Legacy status kept for reference (migration 050 maps these forward).
export const BUDGET_STATUSES = BUDGET_STAGES;

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

/*
 * State machine. `role` names who may run each transition; the API maps it to the
 * session: OWNER = the department's own head (or ADMIN/FINANCE), FINANCE =
 * ADMIN/FINANCE, DEPT_APPROVER = a listed department sign-off approver (or ADMIN),
 * ADMIN = SLT/admin. The transitions are defined and tested here; the role check
 * itself lives in the API where the session and approver list are known.
 */
export const BUDGET_TRANSITIONS = {
  submit_to_finance: { from: ["DRAFT"], to: "FINANCE_REVIEW", role: "OWNER", label: "Submit for Finance review" },
  finance_pass:      { from: ["FINANCE_REVIEW"], to: "DEPT_APPROVAL", role: "FINANCE", label: "Pass to Department approval" },
  finance_return:    { from: ["FINANCE_REVIEW"], to: "DRAFT", role: "FINANCE", label: "Return to draft" },
  dept_approve:      { from: ["DEPT_APPROVAL"], to: "SLT_APPROVAL", role: "DEPT_APPROVER", label: "Approve (department)" },
  dept_return:       { from: ["DEPT_APPROVAL"], to: "DRAFT", role: "DEPT_APPROVER", label: "Return to draft" },
  slt_approve:       { from: ["SLT_APPROVAL"], to: "LOCKED", role: "ADMIN", label: "Approve & lock (SLT)" },
  slt_return:        { from: ["SLT_APPROVAL"], to: "DRAFT", role: "ADMIN", label: "Return to draft" },
  reopen:            { from: ["LOCKED"], to: "DRAFT", role: "FINANCE", label: "Reopen" },
};

export function budgetTransitionError(action, status) {
  const t = BUDGET_TRANSITIONS[action];
  if (!t) return `Unknown action '${action}'`;
  if (!BUDGET_STAGES.includes(status)) return `Unknown status '${status}'`;
  if (!t.from.includes(status)) return `Cannot ${action.replace(/_/g, " ")} a budget that is ${STAGE_LABEL[status] || status}`;
  return null;
}

// The transitions available from a given stage (for rendering the action buttons).
export function availableTransitions(status) {
  return Object.entries(BUDGET_TRANSITIONS)
    .filter(([, t]) => t.from.includes(status))
    .map(([action, t]) => ({ action, to: t.to, role: t.role, label: t.label }));
}

// Only a DRAFT budget's figures can be edited; later stages are locked (return or
// reopen to edit again).
export const isEditableBudget = (status) => status === "DRAFT";

// ---- Summary, phasing views, movers and validation (the control centre) ----

export const QUARTERS = [
  ["Q1", ["m01", "m02", "m03"]], ["Q2", ["m04", "m05", "m06"]],
  ["Q3", ["m07", "m08", "m09"]], ["Q4", ["m10", "m11", "m12"]],
];

export function quarterTotals(line = {}) {
  return QUARTERS.map(([, ks]) => round2(ks.reduce((t, k) => t + num(line[k]), 0)));
}

// Share of named lines that have a non-zero full-year total.
export function completionPct(lines = []) {
  const named = lines.filter((l) => l && String(l.line_label || "").trim());
  if (!named.length) return 0;
  const filled = named.filter((l) => lineTotal(l) !== 0).length;
  return Math.round((filled / named.length) * 100);
}

// The budget control-centre summary: envelope vs proposed vs prior year + completion.
export function budgetSummary(target, lines = []) {
  const proposed = grandTotal(lines);
  const prior = priorYearTotal(lines);
  const t = Number(target) || 0;
  const v = variance(proposed, prior);
  return {
    target: t || null,
    proposed,
    remaining: t ? round2(t - proposed) : null,
    priorYear: prior,
    vsPriorAbs: v.abs,
    vsPriorPct: v.pct,
    completion: completionPct(lines),
  };
}

// Top increases / reductions vs prior year (for the Overview page).
export function lineMovers(lines = [], n = 5) {
  const rows = lines
    .filter((l) => String(l.line_label || "").trim())
    .map((l) => ({ label: l.line_label, category: l.category, total: lineTotal(l), prior: num(l.prior_year), delta: round2(lineTotal(l) - num(l.prior_year)) }));
  return {
    up: rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n),
    down: rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n),
  };
}

/*
 * Validation issues surfaced on Review & Submit. A line is "material" (and so needs
 * commentary) when its full-year total is ≥ the £ threshold or it moves ≥ the %
 * threshold vs prior year. Empty lines are incomplete, not invalid.
 */
export function budgetValidation(target, lines = [], { commentaryThreshold = 10000, changePctThreshold = 10 } = {}) {
  const issues = [];
  const s = budgetSummary(target, lines);
  if (s.target != null && s.proposed > s.target) {
    issues.push({ level: "warn", code: "over_target", message: `Proposed exceeds the target by ${gbp(s.proposed - s.target)}` });
  }
  for (const l of lines) {
    const label = String(l.line_label || "").trim();
    if (!label) { issues.push({ level: "warn", code: "unnamed_line", message: "A cost line has no name" }); continue; }
    const total = lineTotal(l);
    if (total === 0) continue;
    const v = variance(total, num(l.prior_year));
    const material = total >= commentaryThreshold || (v.pct != null && Math.abs(v.pct) >= changePctThreshold);
    if (material && !String(l.commentary || "").trim()) {
      issues.push({ level: "warn", code: "missing_commentary", line: label, message: `${label} needs commentary (≥${gbp(commentaryThreshold)} or ${changePctThreshold}%+ vs prior year)` });
    }
  }
  return issues;
}

// Compact £ for validation/summary messages.
function gbp(n) {
  const v = Math.round(Number(n) || 0);
  return `£${v.toLocaleString("en-GB")}`;
}
