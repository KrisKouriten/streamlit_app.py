/*
 * Business Projects (Plan — HO) — pure validation + summary. A register of
 * cross-functional business change projects. No external feed; entered in-app.
 */
export const STATUSES = ["Planned", "Active", "On hold", "Done"];
export const RAGS = ["green", "amber", "red"];

// A real calendar date as 'YYYY-MM-DD', or null. Accepts an ISO string (or the
// start of one, e.g. a timestamp) or a Date; rejects 2026-02-31 and the like.
export function isoDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/*
 * A project's dates (migration 122):
 *   start_date   planned start
 *   target_date  target finish
 *   target_ym    the target finish month 'YYYY-MM' — kept, and set from the
 *                target finish date, because the projects dashboard's delivery
 *                timeline groups by it. A project saved before the dates
 *                existed keeps the month it had until a finish date is given.
 */
export function validateProject(i = {}) {
  const errors = [];
  const name = String(i.name || "").trim();
  if (!name) errors.push("Project name is required");
  const status = STATUSES.includes(i.status) ? i.status : "Planned";
  const rag = RAGS.includes(i.rag) ? i.rag : "green";
  const start_date = isoDate(i.start_date);
  const target_date = isoDate(i.target_date);
  if (i.start_date && !start_date) errors.push("Planned start date isn't a real date");
  if (i.target_date && !target_date) errors.push("Target finish date isn't a real date");
  if (start_date && target_date && target_date < start_date) errors.push("The target finish date is before the planned start date");
  const legacyYm = /^\d{4}-\d{2}$/.test(String(i.target_ym || "")) ? String(i.target_ym) : null;
  const target_ym = target_date ? target_date.slice(0, 7) : legacyYm;
  // A month-only target kept from before the dates existed can still be before the start.
  if (start_date && !target_date && legacyYm && legacyYm < start_date.slice(0, 7)) errors.push("The target finish month is before the planned start date — set a target finish date");
  const b = i.budget == null || i.budget === "" ? null : Number(String(i.budget).replace(/[£,\s]/g, ""));
  const budget = Number.isFinite(b) ? b : null;
  const id = i.id ? Number(i.id) : null;
  return {
    errors,
    clean: { id: Number.isFinite(id) ? id : null, name, category: String(i.category || "").trim() || null, owner: String(i.owner || "").trim() || null, status, rag, start_date, target_date, target_ym, budget, notes: String(i.notes || "").trim() || null },
  };
}

/*
 * Can this project be deleted, and by whom?
 *   project   { created_by }
 *   links     { pos, budgets } — P.Os tagged to it (any status) and departmental
 *             budgets set against it
 *   who       { actor, canManage } — canManage: Finance or Admin
 * → null, or the reason it can't be.
 *
 * Its planned cost lines go with it. P.Os and departmental budgets don't: a
 * tagged P.O carries the project's actual spend (and the database refuses to
 * orphan it), and a project budget left without its project would carry card
 * and miscellaneous spend against nothing. So those stop the delete — mark the
 * project Done to keep its history. A P.O can only be moved to another project
 * while it can still be edited (draft, rejected or challenged), so the message
 * offers that as the exception, not the fix.
 */
export function projectDeleteError(project = {}, links = {}, who = {}) {
  const owner = String(project.created_by || "").toLowerCase();
  const actor = String(who.actor || "").toLowerCase();
  if (!who.canManage && !(owner && actor && owner === actor)) return "Only whoever set the project up, or Finance, can delete it";
  const pos = Number(links.pos) || 0, budgets = Number(links.budgets) || 0;
  if (pos) return `${pos} P.O${pos === 1 ? " is" : "s are"} tagged to this project — mark the project Done to keep its history (a P.O can be moved to another project on P.O Requests only while it is a draft, rejected or challenged)`;
  if (budgets) return `${budgets} departmental budget${budgets === 1 ? " is" : "s are"} set against this project — remove or move ${budgets === 1 ? "it" : "them"} first, or mark the project Done`;
  return null;
}

// A project date for display: DD/MM/YYYY, or for a project saved before the
// dates existed, its target month ("Sep 2026").
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function projectDateLabel(iso, ymFallback = null) {
  const d = isoDate(iso);
  if (d) return d.split("-").reverse().join("/");
  const m = /^(\d{4})-(\d{2})$/.exec(String(ymFallback || ""));
  return m ? `${MON[+m[2] - 1]} ${m[1]}` : "—";
}

// Validate a planned-cost line (mirrors validateProject). A cost line belongs to
// a project and carries a £ amount; department/cost_line/notes are free text.
export function validateCost(i = {}) {
  const errors = [];
  const projId = i.business_project_id == null || i.business_project_id === "" ? null : Number(i.business_project_id);
  if (!Number.isFinite(projId)) errors.push("A business project is required");
  const a = i.amount == null || i.amount === "" ? 0 : Number(String(i.amount).replace(/[£,\s]/g, ""));
  const amount = Number.isFinite(a) ? a : NaN;
  if (!Number.isFinite(amount)) errors.push("Amount must be a number");
  const id = i.id ? Number(i.id) : null;
  return {
    errors,
    clean: {
      id: Number.isFinite(id) ? id : null,
      business_project_id: Number.isFinite(projId) ? projId : null,
      department: String(i.department || "").trim() || null,
      cost_line: String(i.cost_line || "").trim() || null,
      amount: Number.isFinite(amount) ? amount : 0,
      notes: String(i.notes || "").trim() || null,
    },
  };
}

// Merge PLANNED cost lines and ACTUAL P.O spend into a per-department view.
// costs: [{ department, amount }] planned; actuals: [{ department, actual }] from
// tagged POs. Departments are keyed null/'' → 'Unassigned'. variance = planned −
// actual (negative = overspent vs plan). Pure — no DB, no imports.
export function summariseProjectCosts(costs = [], actuals = [], budget = null) {
  const DEPT = (d) => (d == null || String(d).trim() === "" ? "Unassigned" : String(d));
  const m = new Map();
  const get = (key) => {
    if (!m.has(key)) m.set(key, { department: key, planned: 0, actual: 0, variance: 0 });
    return m.get(key);
  };
  let planned = 0;
  let actual = 0;
  for (const c of costs) {
    const amt = Number(c.amount) || 0;
    get(DEPT(c.department)).planned += amt;
    planned += amt;
  }
  for (const a of actuals) {
    const amt = Number(a.actual) || 0;
    get(DEPT(a.department)).actual += amt;
    actual += amt;
  }
  const byDept = [...m.values()]
    .map((r) => ({ ...r, variance: r.planned - r.actual }))
    .sort((a, b) => a.department.localeCompare(b.department));
  const b = budget == null ? null : Number(budget);
  return { byDept, totals: { budget: Number.isFinite(b) ? b : null, planned, actual, variance: planned - actual } };
}

export function summarise(projects = []) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const rag = { green: 0, amber: 0, red: 0 };
  let budget = 0;
  for (const p of projects) {
    if (p.status in byStatus) byStatus[p.status]++;
    if (p.rag in rag) rag[p.rag]++;
    if (p.status !== "Done") budget += Number(p.budget) || 0;
  }
  return { total: projects.length, byStatus, rag, budget, active: byStatus["Active"] || 0, atRisk: rag.red };
}

// Committed budget counts open projects only (Done projects are delivered, so
// their budget is no longer a forward commitment). Shared by the groupers below
// and the summary, so "committed" means the same thing everywhere.
const isOpen = (p) => p.status !== "Done";

// Budget commitment + count by project category, richest commitment first.
export function groupByCategory(projects = []) {
  const m = new Map();
  for (const p of projects) {
    const key = p.category || "Uncategorised";
    const g = m.get(key) || { category: key, count: 0, budget: 0 };
    g.count++;
    if (isOpen(p)) g.budget += Number(p.budget) || 0;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.budget - a.budget || b.count - a.count);
}

// Delivery timeline: budget + count by target month (only projects with a
// target month), earliest first.
export function groupByMonth(projects = []) {
  const m = new Map();
  for (const p of projects) {
    if (!p.target_ym) continue;
    const g = m.get(p.target_ym) || { ym: p.target_ym, count: 0, budget: 0 };
    g.count++;
    if (isOpen(p)) g.budget += Number(p.budget) || 0;
    m.set(p.target_ym, g);
  }
  return [...m.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}
