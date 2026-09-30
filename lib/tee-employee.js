import { query } from "./db";
import { MONTH_KEYS } from "./dept-budget-rules.js";

/*
 * Travel, Expenses & Entertainment budgets per employee (migration 118).
 *
 * A department's T&E budget can be split per reportee. The department
 * budget's own lines stay the approved figures and are always the sum of the
 * rows here; this module only stores and reads the split. It depends on the
 * database alone, so the budget upload and the expense report can both use it.
 */

// Migration 118's statement, pinned to the file by tests/tee-budget-rules.test.mjs.
export const TEE_EMPLOYEE_SQL = `CREATE TABLE IF NOT EXISTS finance.tee_budget_employee (
  budget_id   bigint NOT NULL REFERENCES finance.dept_budget(budget_id) ON DELETE CASCADE,
  employee    varchar(160) NOT NULL,
  line_label  varchar(120) NOT NULL,
  m01 numeric(14,2) NOT NULL DEFAULT 0, m02 numeric(14,2) NOT NULL DEFAULT 0, m03 numeric(14,2) NOT NULL DEFAULT 0,
  m04 numeric(14,2) NOT NULL DEFAULT 0, m05 numeric(14,2) NOT NULL DEFAULT 0, m06 numeric(14,2) NOT NULL DEFAULT 0,
  m07 numeric(14,2) NOT NULL DEFAULT 0, m08 numeric(14,2) NOT NULL DEFAULT 0, m09 numeric(14,2) NOT NULL DEFAULT 0,
  m10 numeric(14,2) NOT NULL DEFAULT 0, m11 numeric(14,2) NOT NULL DEFAULT 0, m12 numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (budget_id, employee, line_label)
)`;

const missing = (e) => e?.code === "42P01";
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/*
 * Replace a budget's employee split. `employees` is the parser's shape,
 * [{ employee, lines: [{ label, months: [12] }] }]; an empty list clears the
 * split, making it a department-level budget again. Creates the table first
 * when it is not there yet, so the first employee-level upload works whether
 * or not migration 118 has been run on this branch.
 */
export async function saveEmployeeSplit(budgetId, employees = []) {
  try {
    await query(`DELETE FROM finance.tee_budget_employee WHERE budget_id = $1`, [budgetId]);
  } catch (e) {
    if (!missing(e)) throw e;
    if (!employees.length) return;
    await query(TEE_EMPLOYEE_SQL);
  }
  for (const e of employees) {
    for (const l of e.lines) {
      await query(
        `INSERT INTO finance.tee_budget_employee (budget_id, employee, line_label, ${MONTH_KEYS.join(", ")})
         VALUES ($1, $2, $3, ${MONTH_KEYS.map((_, i) => `$${i + 4}`).join(", ")})`,
        [budgetId, e.employee, l.label, ...l.months.map(round2)]);
    }
  }
}

/*
 * The employee split of one or more budgets.
 *   → { [budgetId]: [{ employee, total, months: [12], lines: { line: [12] } }] }
 * Empty for a department-level budget, and before the table exists.
 */
export async function employeeSplits(budgetIds = []) {
  const ids = [...new Set((budgetIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return {};
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT budget_id, employee, line_label, ${MONTH_KEYS.join(", ")}
         FROM finance.tee_budget_employee WHERE budget_id = ANY($1::bigint[])
        ORDER BY employee, line_label`, [ids]));
  } catch (e) { if (missing(e)) return {}; throw e; }
  const out = {};
  for (const r of rows) {
    const list = (out[r.budget_id] ||= []);
    let e = list.find((x) => x.employee === r.employee);
    if (!e) { e = { employee: r.employee, total: 0, months: Array(12).fill(0), lines: {} }; list.push(e); }
    const m = MONTH_KEYS.map((k) => Number(r[k]) || 0);
    e.lines[r.line_label] = m;
    e.months = e.months.map((v, i) => round2(v + m[i]));
    e.total = round2(e.total + m.reduce((a, v) => a + v, 0));
  }
  return out;
}
