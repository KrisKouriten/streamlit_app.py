import { query } from "./db";
import { validateProject } from "./business-projects-rules.js";

/* Business Projects (Plan — HO) — DB layer over finance.business_project. */
const tableMissing = (e) => e?.code === "42P01";

export async function getBusinessProjects() {
  try {
    const { rows } = await query(
      `SELECT business_project_id AS id, name, category, owner, status, rag, target_ym, budget, notes, updated_at
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
