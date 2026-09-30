/*
 * Travel, Expenses & Entertainment budgets on Departmental Budgets — pure and
 * unit-testable: who may load a department's T&E budget, what an upload may
 * do to the budget already there, and matching employees to claimants.
 */

const STAGE_LABEL = { FINANCE_REVIEW: "in Finance review", DEPT_APPROVAL: "with the department head", SLT_APPROVAL: "with SLT", LOCKED: "approved and locked" };

/*
 * What an upload may do to a department's T&E budget for a year.
 *   none yet       CREATE a draft
 *   a draft        FILL it (its lines, and its employee split, are replaced)
 *   anything else  LOCKED — once submitted for approval a budget cannot be
 *                  replaced or amended. It has to be returned to draft on
 *                  Departmental Budgets first, which means approving it again.
 */
export function teeUploadAction(target = null) {
  if (!target) return { action: "CREATE" };
  if (target.status === "DRAFT") return { action: "FILL" };
  const where = STAGE_LABEL[target.status] || String(target.status || "").toLowerCase().replace(/_/g, " ");
  return { action: "LOCKED", reason: `submitted for approval (${where}) — return it to draft to change it; it then needs approving again` };
}

/*
 * The departments a person may load T&E budgets for: Finance and admins every
 * department; anyone else the departments they head (sign-off approver) and
 * their own department — the people who can edit that department's draft.
 */
export function teeUploadDepartments({ isFinance = false, headed = [], myDept = null, departments = [] } = {}) {
  if (isFinance) return [...departments];
  const mine = new Set([...(headed || []), ...(myDept ? [myDept] : [])]);
  return departments.filter((d) => mine.has(d));
}

// Names compared the way people write them: case, spacing and a trailing
// "(email)" ignored — the expense export writes "Name (name@…)" at times.
export function employeeKey(name) {
  return String(name || "").replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

// The budget of one employee in a split, by name. Null when there is none.
export function findEmployeeBudget(split = [], name) {
  const k = employeeKey(name);
  if (!k) return null;
  return (split || []).find((e) => employeeKey(e.employee) === k) || null;
}

// A department's budget level, for the page: "Per employee" once it has a split.
export function teeLevel(split = []) {
  return (split || []).length ? "EMPLOYEE" : "DEPARTMENT";
}
