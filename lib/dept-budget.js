import { query } from "./db";
import { audit } from "./governance";
import {
  MONTH_KEYS, validateBudget, validateLine, budgetTransitionError, isEditableBudget,
} from "./dept-budget-rules.js";

/*
 * Departmental Budgets — DB layer. A department head creates a budget (seeded
 * from the department's starter template), edits the cost-line grid while it is
 * a DRAFT, then submits it for the department's sign-off approvers to APPROVE.
 * The grid maths and the state machine live in dept-budget-rules.js; this layer
 * is the reads and writes. Degrades to { ready:false } before migration 049
 * (42P01), and every mutation is audited.
 */

const tableMissing = (e) => e?.code === "42P01";
const missing = (e) => e?.code === "42P01" || e?.code === "42703";
const actorOf = (a) => a?.email || a?.name || "system";
const num = (v) => Number(v) || 0;

export async function listBudgets({ department = null, year = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT budget_id, department, budget_year, version_label, status, created_by,
              created_at, updated_at, submitted_by, submitted_at, approved_by, approved_at
       FROM finance.dept_budget
       WHERE ($1::varchar IS NULL OR department = $1)
         AND ($2::int IS NULL OR budget_year = $2)
       ORDER BY budget_year DESC, department, version_label`,
      [department, year]
    );
    return { ready: true, budgets: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, budgets: [] };
    throw e;
  }
}

export async function getBudget(budgetId) {
  try {
    const { rows } = await query(`SELECT * FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
    const budget = rows[0] || null;
    if (!budget) return null;
    const { rows: lines } = await query(
      `SELECT line_id, category, line_label, sort_order, prior_year, ${MONTH_KEYS.join(", ")}
       FROM finance.dept_budget_line WHERE budget_id = $1 ORDER BY sort_order, line_id`,
      [budgetId]
    );
    return { budget, lines };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

export async function listTemplates(department) {
  try {
    const { rows } = await query(
      `SELECT category, line_label, sort_order FROM finance.dept_budget_template
       WHERE department = $1 ORDER BY sort_order, line_label`,
      [department]
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

// Create a budget and seed its cost lines from the department's starter template.
export async function createBudget({ department, budget_year, version_label }, actor) {
  const err = validateBudget({ department, budget_year });
  if (err) throw new Error(err);
  let budgetId;
  try {
    const { rows } = await query(
      `INSERT INTO finance.dept_budget (department, budget_year, version_label, created_by)
       VALUES ($1,$2,COALESCE(NULLIF($3,''),'Working draft'),$4) RETURNING budget_id`,
      [department.trim(), Number(budget_year), version_label || null, actorOf(actor)]
    );
    budgetId = rows[0].budget_id;
  } catch (e) {
    if (e?.code === "23505") throw new Error("A budget with that department, year and version already exists — use a different version label");
    throw e;
  }
  const tpl = await listTemplates(department);
  for (const t of tpl) {
    await query(
      `INSERT INTO finance.dept_budget_line (budget_id, category, line_label, sort_order)
       VALUES ($1,$2,$3,$4)`,
      [budgetId, t.category, t.line_label, t.sort_order]
    );
  }
  await audit({ actor, eventType: "dept_budget.create", objectType: "dept_budget", objectRef: String(budgetId), detail: { department, budget_year, seeded: tpl.length } });
  return { budgetId };
}

async function requireEditable(budgetId) {
  const { rows } = await query(`SELECT status FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  if (!rows.length) throw new Error("Budget not found");
  if (!isEditableBudget(rows[0].status)) throw new Error(`This budget is ${rows[0].status.toLowerCase()} and cannot be edited — reopen it first`);
  return rows[0].status;
}

// Replace the whole cost-line grid for a DRAFT budget.
export async function saveLines(budgetId, lines = [], actor) {
  await requireEditable(budgetId);
  for (const l of lines) {
    const err = validateLine(l);
    if (err) throw new Error(err);
  }
  await query(`DELETE FROM finance.dept_budget_line WHERE budget_id = $1`, [budgetId]);
  let order = 0;
  const monthCols = MONTH_KEYS.join(", ");
  const monthPlaceholders = MONTH_KEYS.map((_, i) => `$${6 + i}`).join(", ");
  for (const l of lines) {
    await query(
      `INSERT INTO finance.dept_budget_line (budget_id, category, line_label, sort_order, prior_year, ${monthCols})
       VALUES ($1,$2,$3,$4,$5,${monthPlaceholders})`,
      [budgetId, (l.category || "General").trim(), String(l.line_label).trim(), l.sort_order ?? order, num(l.prior_year), ...MONTH_KEYS.map((k) => num(l[k]))]
    );
    order += 10;
  }
  await query(`UPDATE finance.dept_budget SET updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`, [budgetId]);
  await audit({ actor, eventType: "dept_budget.save_lines", objectType: "dept_budget", objectRef: String(budgetId), detail: { lines: lines.length } });
  return { ok: true };
}

async function statusOf(budgetId) {
  const { rows } = await query(`SELECT status FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  if (!rows.length) throw new Error("Budget not found");
  return rows[0].status;
}

export async function submitBudget(budgetId, actor) {
  const st = await statusOf(budgetId);
  const e = budgetTransitionError("submit", st);
  if (e) throw new Error(e);
  await query(
    `UPDATE finance.dept_budget SET status = 'SUBMITTED', submitted_by = $2, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`,
    [budgetId, actorOf(actor)]
  );
  await audit({ actor, eventType: "dept_budget.submit", objectType: "dept_budget", objectRef: String(budgetId) });
  return { ok: true, status: "SUBMITTED" };
}

export async function approveBudget(budgetId, actor) {
  const st = await statusOf(budgetId);
  const e = budgetTransitionError("approve", st);
  if (e) throw new Error(e);
  await query(
    `UPDATE finance.dept_budget SET status = 'APPROVED', approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`,
    [budgetId, actorOf(actor)]
  );
  await audit({ actor, eventType: "dept_budget.approve", objectType: "dept_budget", objectRef: String(budgetId) });
  return { ok: true, status: "APPROVED" };
}

// Reopen a submitted/approved budget for further edits (clears the sign-off).
export async function reopenBudget(budgetId, actor) {
  const st = await statusOf(budgetId);
  const e = budgetTransitionError("reopen", st);
  if (e) throw new Error(e);
  await query(
    `UPDATE finance.dept_budget SET status = 'DRAFT', submitted_by = NULL, submitted_at = NULL, approved_by = NULL, approved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`,
    [budgetId]
  );
  await audit({ actor, eventType: "dept_budget.reopen", objectType: "dept_budget", objectRef: String(budgetId) });
  return { ok: true, status: "DRAFT" };
}

export async function deleteBudget(budgetId, actor) {
  await query(`DELETE FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  await audit({ actor, eventType: "dept_budget.delete", objectType: "dept_budget", objectRef: String(budgetId) });
  return { ok: true };
}

// The department a budget belongs to (for permission checks in the API layer).
export async function budgetDepartment(budgetId) {
  const { rows } = await query(`SELECT department FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  return rows[0]?.department || null;
}

// The signed-in user's department (users.department, migration 047).
export async function getUserDepartment(userId) {
  try {
    const { rows } = await query(`SELECT department FROM public.users WHERE id = $1`, [userId]);
    return rows[0]?.department || null;
  } catch {
    return null;
  }
}

// The sign-off approver emails for a department (governance.department_signoff,
// migration 048). Empty before those tables exist.
export async function getApproverEmails(department) {
  try {
    const { rows } = await query(`SELECT signoff_email FROM governance.department_signoff WHERE department = $1`, [department]);
    return rows.map((r) => r.signoff_email);
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}
