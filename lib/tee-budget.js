import { query } from "./db";
import { audit, listDepartments } from "./governance";
import { listBudgets, createBudget } from "./dept-budget";
import { MONTH_KEYS, grandTotal } from "./dept-budget-rules.js";
import { resolveDepartment, teeLineOf, parseTeeBudgetRows, teeTemplateRows, TEE_CATEGORY, pickTeeBudget, UNALLOCATED } from "./expense-rules.js";
import { teeUploadAction, employeeKey, teeLevel } from "./tee-budget-rules.js";
import { employeeSplits, saveEmployeeSplit } from "./tee-employee.js";
import { linesForYear, getDeptMap } from "./expenses";
import { parseCsvRows } from "./intercompany-rules.js";
import * as XLSX from "xlsx";

/*
 * Travel, Expenses & Entertainment budgets, loaded on Departmental Budgets.
 *
 * Each department's head (or Finance) downloads a template, fills in the
 * budget — for the department, or per employee — and uploads it. The upload
 * fills the department's draft T&E budget, which then goes through the same
 * sign-off as any other budget. Once submitted for approval it cannot be
 * replaced by an upload: it is returned to draft first, and approved again.
 * Expense Claims then reads claims against the approved figures.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/*
 * Each department's T&E budget for a year, for the Departmental Budgets page.
 *   → [{ department, budgetId, status, version, total, level, employees }]
 * Departments without one are listed with budgetId null.
 */
export async function teeBudgetOverview(year, departments = []) {
  const { budgets = [] } = await listBudgets({ year }).catch(() => ({ budgets: [] }));
  const chosen = new Map();
  for (const d of departments) {
    const b = pickTeeBudget(budgets.filter((x) => x.department === d));
    if (b) chosen.set(d, b);
  }
  const ids = [...chosen.values()].map((b) => b.budget_id);
  const [splits, totals] = await Promise.all([
    employeeSplits(ids).catch(() => ({})),
    ids.length
      ? query(`SELECT budget_id, ${MONTH_KEYS.map((k) => `SUM(${k}) AS ${k}`).join(", ")} FROM finance.dept_budget_line WHERE budget_id = ANY($1::bigint[]) GROUP BY budget_id`, [ids])
        .then((r) => Object.fromEntries(r.rows.map((x) => [x.budget_id, grandTotal([x])]))).catch(() => ({}))
      : {},
  ]);
  return departments.map((d) => {
    const b = chosen.get(d);
    if (!b) return { department: d, budgetId: null, status: null, total: 0, level: null, employees: 0 };
    const split = splits[b.budget_id] || [];
    return {
      department: d, budgetId: b.budget_id, status: b.status, version: b.version_label,
      total: round2(totals[b.budget_id] || 0), level: teeLevel(split),
      employees: split.filter((e) => e.employee !== UNALLOCATED).length,
    };
  });
}

/*
 * The template for a year and set of departments, as rows for CSV.
 *   level "DEPARTMENT"  one row per department × line
 *   level "EMPLOYEE"    one row per employee × line, for everyone who claimed
 *                       in the department that year and anyone already in its
 *                       employee split
 * The reference column is what was claimed on each line so far (per employee
 * at employee level).
 */
export async function teeBudgetTemplate(year, { departments = [], level = "DEPARTMENT" } = {}) {
  const refYear = Math.min(Number(year), new Date().getFullYear());
  const reference = {};
  const employees = {};
  const perEmployee = level === "EMPLOYEE";
  try {
    const { lines } = await linesForYear(refYear);
    for (const l of lines) {
      if (!l.mapped || !departments.includes(l.department)) continue;
      const t = teeLineOf(l);
      if (perEmployee) {
        const e = String(l.claimant || "").trim();
        if (!e) continue;
        const list = (employees[l.department] ||= []);
        const name = list.find((x) => employeeKey(x) === employeeKey(e)) || (list.push(e), e);
        const ref = ((reference[l.department] ||= {})[name] ||= {});
        ref[t] = (ref[t] || 0) + l.net_amount;
      } else {
        (reference[l.department] ||= {})[t] = (reference[l.department][t] || 0) + l.net_amount;
      }
    }
  } catch { /* no claims loaded yet — the template still works */ }
  if (perEmployee) {
    // Keep anyone already budgeted, so a template downloaded again still lists them.
    const { budgets = [] } = await listBudgets({ year }).catch(() => ({ budgets: [] }));
    const ids = {};
    for (const d of departments) { const b = pickTeeBudget(budgets.filter((x) => x.department === d)); if (b) ids[d] = b.budget_id; }
    const splits = await employeeSplits(Object.values(ids)).catch(() => ({}));
    for (const [d, id] of Object.entries(ids)) {
      const list = (employees[d] ||= []);
      for (const e of splits[id] || []) {
        if (e.employee !== UNALLOCATED && !list.some((x) => employeeKey(x) === employeeKey(e.employee))) list.push(e.employee);
      }
    }
    for (const d of departments) (employees[d] ||= []).sort((a, b) => a.localeCompare(b));
  }
  return teeTemplateRows(year, [...departments].sort(), reference, `Claimed ${refYear} to date (reference)`, { employees: perEmployee ? employees : {} });
}

function readRows(buffer, filename) {
  if (/\.xlsx?$/i.test(filename || "")) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  }
  return parseCsvRows(Buffer.from(buffer).toString("utf8"));
}

/*
 * Load T&E budgets from the template (CSV or Excel).
 *   allowed  the departments this person may load (teeUploadDepartments);
 *            rows for any other department are refused and named
 * For each department and year in the file: a draft T&E budget is created if
 * there is none, or the draft's lines and employee split replaced. A budget
 * already submitted for approval is never touched (teeUploadAction).
 */
export async function uploadTeeBudgets(buffer, { filename = "", allowed = [] } = {}, actor) {
  const p = parseTeeBudgetRows(readRows(buffer, filename));
  if (!p.budgets.length) throw new Error(p.errors[0] || "No T&E budget rows found in that file");
  const depts = (await listDepartments().catch(() => [])).map((d) => d.department_name);
  const map = await getDeptMap();
  const created = [], updated = [], locked = [], unknown = [], notYours = [];
  for (const b of p.budgets) {
    const dept = resolveDepartment(b.department, depts, map) || depts.find((d) => d.toLowerCase() === b.department.toLowerCase());
    if (!dept) { unknown.push(b.department); continue; }
    if (!allowed.includes(dept)) { notYours.push(dept); continue; }
    const { budgets = [] } = await listBudgets({ department: dept, year: b.year }).catch(() => ({ budgets: [] }));
    // The budget the report reads — the same rule, so the upload fills what is shown.
    const target = pickTeeBudget(budgets);
    const act = teeUploadAction(target);
    if (act.action === "LOCKED") { locked.push({ department: dept, year: b.year, status: target.status, reason: act.reason }); continue; }
    const budgetId = act.action === "CREATE"
      ? (await createBudget({ department: dept, budget_year: b.year, version_label: "T&E budget", budget_type: "TEE" }, actor)).budgetId
      : target.budget_id;
    await query(`DELETE FROM finance.dept_budget_line WHERE budget_id = $1`, [budgetId]);
    let order = 0;
    for (const l of b.lines) {
      await query(
        `INSERT INTO finance.dept_budget_line (budget_id, category, line_label, sort_order, ${MONTH_KEYS.join(", ")})
         VALUES ($1, $2, $3, $4, ${MONTH_KEYS.map((_, i) => `$${i + 5}`).join(", ")})`,
        [budgetId, TEE_CATEGORY, l.label, order, ...l.months]);
      order += 10;
    }
    // The split beneath it — cleared when the file sets the department level.
    await saveEmployeeSplit(budgetId, b.employees);
    await query(`UPDATE finance.dept_budget SET updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`, [budgetId]);
    const total = b.lines.reduce((t, l) => t + l.months.reduce((a, v) => a + v, 0), 0);
    const row = {
      department: dept, year: b.year, total: round2(total), lines: b.lines.length,
      level: b.employees.length ? "EMPLOYEE" : "DEPARTMENT",
      employees: b.employees.filter((e) => e.employee !== UNALLOCATED).length,
    };
    (act.action === "CREATE" ? created : updated).push(row);
  }
  await audit({ actor, eventType: "dept_budget.tee_upload", objectType: "dept_budget", objectRef: filename || "upload",
    detail: { created: created.map((r) => `${r.department} ${r.year}`), updated: updated.map((r) => `${r.department} ${r.year}`),
      locked: locked.map((r) => `${r.department} ${r.year} (${r.status})`), notYours: [...new Set(notYours)], unknown: [...new Set(unknown)] } });
  return { ok: true, created, updated, locked, unknown: [...new Set(unknown)], notYours: [...new Set(notYours)], rowErrors: p.errors };
}
