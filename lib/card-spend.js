import { query } from "./db";
import { audit } from "./governance";
import { validateCardSpend } from "./card-spend-rules.js";

/*
 * Card / pre-approved spend — DB layer over finance.card_spend (migration 112). A
 * log of spend already made on a company card (or pre-approved) assigned to a
 * Departmental Budget (Business or Project); it reports as committed spend on the
 * department dashboard, with no P.O or sign-off. The owning department is derived
 * from the assigned budget. Degrades gracefully (ready:false) before the migration.
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

export async function listCardSpend({ budgetId = null, department = null } = {}) {
  try {
    const { rows } = await query(
      `SELECT c.card_id, c.spend_date, c.supplier, c.description, c.amount, c.department,
              c.budget_id, c.notes, c.created_by, c.created_at,
              b.budget_year, b.version_label, b.budget_type, bp.name AS project_name
         FROM finance.card_spend c
         LEFT JOIN finance.dept_budget b ON b.budget_id = c.budget_id
         LEFT JOIN finance.business_project bp ON bp.business_project_id = b.business_project_id
        WHERE ($1::bigint IS NULL OR c.budget_id = $1)
          AND ($2::varchar IS NULL OR c.department = $2)
        ORDER BY c.spend_date DESC NULLS LAST, c.created_at DESC`,
      [budgetId, department]);
    return { ready: true, rows: rows.map((r) => ({ ...r, amount: r.amount == null ? 0 : Number(r.amount) })) };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, rows: [] };
    throw e;
  }
}

export async function addCardSpend(input, actor) {
  const errors = validateCardSpend(input);
  if (errors.length) throw new Error(errors.join("; "));
  const department = await deptForBudget(input.budget_id);
  const { rows } = await query(
    `INSERT INTO finance.card_spend (spend_date, supplier, description, amount, department, budget_id, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING card_id`,
    [input.spend_date || null, String(input.supplier).trim(), input.description || null,
     Number(input.amount), department, Number(input.budget_id), input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "card_spend.add", objectType: "card_spend", objectRef: String(rows[0].card_id),
    detail: { supplier: input.supplier, amount: input.amount, budget_id: input.budget_id } });
  return { ok: true, card_id: rows[0].card_id };
}

export async function updateCardSpend(cardId, patch = {}, actor) {
  const id = Number(cardId);
  if (!Number.isFinite(id)) throw new Error("Invalid entry");
  const { rows: cur } = await query(`SELECT * FROM finance.card_spend WHERE card_id = $1`, [id]);
  if (!cur.length) throw new Error("Entry not found");
  const merged = { ...cur[0], ...patch };
  const errors = validateCardSpend(merged);
  if (errors.length) throw new Error(errors.join("; "));
  const department = await deptForBudget(merged.budget_id);
  await query(
    `UPDATE finance.card_spend
        SET spend_date=$2, supplier=$3, description=$4, amount=$5, department=$6, budget_id=$7, notes=$8,
            updated_by=$9, updated_at=CURRENT_TIMESTAMP
      WHERE card_id=$1`,
    [id, merged.spend_date || null, String(merged.supplier).trim(), merged.description || null,
     Number(merged.amount), department, Number(merged.budget_id), merged.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "card_spend.update", objectType: "card_spend", objectRef: String(id) });
  return { ok: true };
}

export async function deleteCardSpend(cardId, actor) {
  const id = Number(cardId);
  if (!Number.isFinite(id)) throw new Error("Invalid entry");
  await query(`DELETE FROM finance.card_spend WHERE card_id = $1`, [id]);
  await audit({ actor, eventType: "card_spend.delete", objectType: "card_spend", objectRef: String(id) });
  return { ok: true };
}

// Card-spend rollup for one budget — reported as committed spend on the
// Departmental Budget Dashboard. Never throws before migration 112.
export async function cardSpendTotalForBudget(budgetId) {
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total, COUNT(*)::int AS n
         FROM finance.card_spend WHERE budget_id = $1`, [budgetId]);
    return { total: Math.round((Number(rows[0]?.total) || 0) * 100) / 100, count: rows[0]?.n || 0 };
  } catch (e) {
    if (tableMissing(e)) return { total: 0, count: 0 };
    throw e;
  }
}
