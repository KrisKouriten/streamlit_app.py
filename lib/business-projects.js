import { query } from "./db";
import { validateProject, validateCost } from "./business-projects-rules.js";

/* Business Projects (Plan — HO) — DB layer over finance.business_project. */
const tableMissing = (e) => e?.code === "42P01";
// A missing column (42703) or missing table (42P01) — used where a feature
// depends on a migration that may not have run yet (e.g. PO project tagging).
const featureMissing = (e) => e?.code === "42P01" || e?.code === "42703";

export async function getBusinessProjects() {
  try {
    const { rows } = await query(
      `SELECT business_project_id AS id, name, category, owner, status, rag, target_ym, budget, notes, updated_at, created_by
       FROM finance.business_project
       ORDER BY CASE status WHEN 'Active' THEN 0 WHEN 'Planned' THEN 1 WHEN 'On hold' THEN 2 ELSE 3 END,
                CASE rag WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, updated_at DESC`
    );
    return { ready: true, projects: rows.map((r) => ({ ...r, budget: r.budget == null ? null : Number(r.budget) })) };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, projects: [] };
    throw e;
  }
}

export async function upsertBusinessProject(input, actor) {
  const { clean, errors } = validateProject(input);
  if (errors.length) throw new Error(errors.join("; "));
  if (clean.id) {
    await query(
      `UPDATE finance.business_project SET name=$2, category=$3, owner=$4, status=$5, rag=$6, target_ym=$7, budget=$8, notes=$9, updated_by=$10, updated_at=CURRENT_TIMESTAMP
       WHERE business_project_id=$1`,
      [clean.id, clean.name, clean.category, clean.owner, clean.status, clean.rag, clean.target_ym, clean.budget, clean.notes, actor]
    );
    return { id: clean.id };
  }
  const { rows } = await query(
    `INSERT INTO finance.business_project (name, category, owner, status, rag, target_ym, budget, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING business_project_id AS id`,
    [clean.name, clean.category, clean.owner, clean.status, clean.rag, clean.target_ym, clean.budget, clean.notes, actor]
  );
  return { id: rows[0].id };
}

/* ---- Planned costs vs actual P.O spend (migration 089 + 088) ---- */

// Planned cost lines for one project. Graceful: no cost table yet → [].
export async function listProjectCosts(projectId) {
  try {
    const { rows } = await query(
      `SELECT cost_id, department, cost_line, amount, notes
       FROM finance.business_project_cost
       WHERE business_project_id = $1
       ORDER BY department NULLS FIRST, cost_line NULLS FIRST`,
      [projectId]
    );
    return rows.map((r) => ({ cost_id: r.cost_id, department: r.department, cost_line: r.cost_line, amount: Number(r.amount) || 0, notes: r.notes }));
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

// Actual P.O spend for one project, grouped by department. Graceful: no
// project-tag column / no PO table yet → [].
export async function projectActualsByDept(projectId) {
  try {
    const { rows } = await query(
      `SELECT department, SUM(payment_value) AS actual
       FROM finance.purchase_order
       WHERE business_project_id = $1
       GROUP BY department`,
      [projectId]
    );
    return rows.map((r) => ({ department: r.department, actual: Number(r.actual) || 0 }));
  } catch (e) {
    if (featureMissing(e)) return [];
    throw e;
  }
}

// The single project header (budget as Number), its planned cost lines and its
// actual PO spend by department. project is null if the id is not found.
export async function getProjectDetail(projectId) {
  let project = null;
  try {
    const { rows } = await query(
      `SELECT business_project_id AS id, name, category, owner, status, rag, target_ym, budget, notes, updated_at, created_by
       FROM finance.business_project WHERE business_project_id = $1`,
      [projectId]
    );
    if (rows.length) project = { ...rows[0], budget: rows[0].budget == null ? null : Number(rows[0].budget) };
  } catch (e) {
    if (tableMissing(e)) return { project: null, costs: [], actuals: [] };
    throw e;
  }
  if (!project) return { project: null, costs: [], actuals: [] };
  const [costs, actuals] = await Promise.all([listProjectCosts(projectId), projectActualsByDept(projectId)]);
  return { project, costs, actuals };
}

// Create or update a planned cost line.
export async function upsertProjectCost(input, actor) {
  const { clean, errors } = validateCost(input);
  if (errors.length) throw new Error(errors.join("; "));
  if (clean.id) {
    await query(
      `UPDATE finance.business_project_cost SET department=$2, cost_line=$3, amount=$4, notes=$5, updated_by=$6, updated_at=CURRENT_TIMESTAMP
       WHERE cost_id=$1`,
      [clean.id, clean.department, clean.cost_line, clean.amount, clean.notes, actor]
    );
    return { id: clean.id };
  }
  const { rows } = await query(
    `INSERT INTO finance.business_project_cost (business_project_id, department, cost_line, amount, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING cost_id AS id`,
    [clean.business_project_id, clean.department, clean.cost_line, clean.amount, clean.notes, actor]
  );
  return { id: rows[0].id };
}

// Delete a planned cost line.
export async function deleteProjectCost(costId, actor) {
  await query(`DELETE FROM finance.business_project_cost WHERE cost_id = $1`, [costId]);
  return { id: Number(costId) || costId };
}

// Every project (like getBusinessProjects) decorated with planned (Σ its cost
// lines) and actual (Σ its tagged POs). Graceful-degrades to planned=0/actual=0
// if the cost table or the PO project-tag column is absent.
export async function getProjectsWithSpend() {
  const base = await getBusinessProjects();
  if (!base.ready) return base;

  let planned = new Map();
  try {
    const { rows } = await query(
      `SELECT business_project_id AS id, SUM(amount) AS planned
       FROM finance.business_project_cost GROUP BY business_project_id`
    );
    planned = new Map(rows.map((r) => [String(r.id), Number(r.planned) || 0]));
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }

  let actual = new Map();
  try {
    const { rows } = await query(
      `SELECT business_project_id AS id, SUM(payment_value) AS actual
       FROM finance.purchase_order WHERE business_project_id IS NOT NULL GROUP BY business_project_id`
    );
    actual = new Map(rows.map((r) => [String(r.id), Number(r.actual) || 0]));
  } catch (e) {
    if (!featureMissing(e)) throw e;
  }

  const projects = base.projects.map((p) => ({
    ...p,
    planned: planned.get(String(p.id)) || 0,
    actual: actual.get(String(p.id)) || 0,
  }));
  return { ready: true, projects };
}
