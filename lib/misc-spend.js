import { query } from "./db";
import { audit } from "./governance";
import { validateMiscSpend } from "./misc-spend-rules.js";

/*
 * Miscellaneous spend — DB layer over finance.misc_spend (migration 103). A log of
 * small planned costs assigned to a Departmental Budget (Business or Project). The
 * owning department is derived from the assigned budget. Degrades gracefully
 * (ready:false) before the migration is applied.
 */
const tableMissing = (e) => e?.code === "42P01";
const actorOf = (a) => a?.email || a?.name || "system";

async function deptForBudget(budgetId) {
  if (!(Number(budgetId) > 0)) return null;
  try {
    const { rows } = await query(`SELECT department FROM finance.dept_budget WHERE budget_id = $1`, [Number(budgetId)]);
    return rows[0]?.department || null;
  } catch { return null; }
}

export async function listMiscSpend({ budgetId = null, department = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT m.misc_id, m.spend_date, m.category, m.description, m.amount, m.department,
              m.budget_id, m.notes, m.created_by, m.created_at,
              b.budget_year, b.version_label, b.budget_type, bp.name AS project_name
         FROM finance.misc_spend m
         LEFT JOIN finance.dept_budget b ON b.budget_id = m.budget_id
         LEFT JOIN finance.business_project bp ON bp.business_project_id = b.business_project_id
        WHERE ($1::bigint IS NULL OR m.budget_id = $1)
          AND ($2::varchar IS NULL OR m.department = $2)
        ORDER BY m.spend_date DESC NULLS LAST, m.created_at DESC`,
      [budgetId, department]);
    return { ready: true, rows: rows.map((r) => ({ ...r, amount: r.amount == null ? 0 : Number(r.amount) })) };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, rows: [] };
    throw e;
  }
}

export async function addMiscSpend(input, actor) {
  const errors = validateMiscSpend(input);
  if (errors.length) throw new Error(errors.join("; "));
  const department = await deptForBudget(input.budget_id);
  const { rows } = await query(
    `INSERT INTO finance.misc_spend (spend_date, category, description, amount, department, budget_id, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING misc_id`,
    [input.spend_date || null, String(input.category).trim(), input.description || null,
     Number(input.amount), department, Number(input.budget_id), input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "misc_spend.add", objectType: "misc_spend", objectRef: String(rows[0].misc_id),
    detail: { category: input.category, amount: input.amount, budget_id: input.budget_id } });
  return { ok: true, misc_id: rows[0].misc_id };
}

export async function updateMiscSpend(miscId, patch = {}, actor) {
  const id = Number(miscId);
  if (!Number.isFinite(id)) throw new Error("Invalid entry");
  const { rows: cur } = await query(`SELECT * FROM finance.misc_spend WHERE misc_id = $1`, [id]);
  if (!cur.length) throw new Error("Entry not found");
  const merged = { ...cur[0], ...patch };
  const errors = validateMiscSpend(merged);
  if (errors.length) throw new Error(errors.join("; "));
  const department = await deptForBudget(merged.budget_id);
  await query(
    `UPDATE finance.misc_spend
        SET spend_date=$2, category=$3, description=$4, amount=$5, department=$6, budget_id=$7, notes=$8,
            updated_by=$9, updated_at=CURRENT_TIMESTAMP
      WHERE misc_id=$1`,
    [id, merged.spend_date || null, String(merged.category).trim(), merged.description || null,
     Number(merged.amount), department, Number(merged.budget_id), merged.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "misc_spend.update", objectType: "misc_spend", objectRef: String(id) });
  return { ok: true };
}

export async function deleteMiscSpend(miscId, actor) {
  const id = Number(miscId);
  if (!Number.isFinite(id)) throw new Error("Invalid entry");
  await query(`DELETE FROM finance.misc_spend WHERE misc_id = $1`, [id]);
  await audit({ actor, eventType: "misc_spend.delete", objectType: "misc_spend", objectRef: String(id) });
  return { ok: true };
}

// Misc-spend rollup for one budget — the "Miscellaneous" task total shown on the
// Departmental Budget. Never throws before migration 103.
export async function miscTotalForBudget(budgetId) {
  try {
    const { rows } = await query(
      `SELECT category, COALESCE(SUM(amount),0)::numeric AS total, COUNT(*)::int AS n
         FROM finance.misc_spend WHERE budget_id = $1 GROUP BY category`, [budgetId]);
    const byCategory = {}; let total = 0, count = 0;
    for (const r of rows) { const t = Number(r.total) || 0; byCategory[r.category] = t; total += t; count += r.n; }
    return { total: Math.round(total * 100) / 100, count, byCategory };
  } catch (e) {
    if (tableMissing(e)) return { total: 0, count: 0, byCategory: {} };
    throw e;
  }
}
