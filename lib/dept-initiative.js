import { query } from "./db";
import { audit } from "./governance";
import { syncFinancialLines } from "./dept-budget";
import { MONTH_KEYS, generateLines, validateInitiative } from "./dept-initiative-rules.js";

/*
 * Departmental Budgets — operational planning DB layer (Phase 2). Initiatives
 * (campaigns / projects / contracts) and their cost items are stored here; the
 * phasing/aggregation maths lives in dept-initiative-rules.js. After any change
 * we regenerate the INITIATIVE-sourced financial grid lines via
 * syncFinancialLines so the Finance view always reflects the plan. Degrades to []
 * before migration 051 (42P01).
 */

const missing = (e) => e?.code === "42P01" || e?.code === "42703";
const actorOf = (a) => a?.email || a?.name || "system";
const num = (v) => Number(v) || 0;

export async function listInitiatives(budgetId) {
  try {
    const { rows: inits } = await query(
      `SELECT * FROM finance.dept_budget_initiative WHERE budget_id = $1 ORDER BY sort_order, initiative_id`, [budgetId]);
    if (!inits.length) return [];
    const { rows: costs } = await query(
      `SELECT * FROM finance.dept_budget_initiative_cost
       WHERE initiative_id = ANY($1::bigint[]) ORDER BY sort_order, cost_id`,
      [inits.map((i) => i.initiative_id)]);
    const byInit = new Map(inits.map((i) => [i.initiative_id, { ...i, costs: [] }]));
    for (const c of costs) byInit.get(c.initiative_id)?.costs.push(c);
    return [...byInit.values()];
  } catch (e) { if (missing(e)) return []; throw e; }
}

async function budgetIdOfInitiative(initiativeId) {
  const { rows } = await query(`SELECT budget_id FROM finance.dept_budget_initiative WHERE initiative_id = $1`, [initiativeId]);
  // budget_id is a bigint — the driver returns it as a string. Normalise to a
  // Number so callers (e.g. the route's `initBudget !== budgetId` ownership
  // guard, which compares against Number(body.budgetId)) match on type.
  return rows[0]?.budget_id != null ? Number(rows[0].budget_id) : null;
}

// Regenerate the budget's INITIATIVE-sourced grid lines from its initiatives.
async function resync(budgetId, actor) {
  const inits = await listInitiatives(budgetId);
  const generated = generateLines(inits);
  try { await syncFinancialLines(budgetId, generated, actor); } catch (e) { /* budget not DRAFT — leave grid as-is */ if (!/cannot be edited|not DRAFT/i.test(e.message)) throw e; }
  return generated.length;
}

export async function createInitiative(budgetId, input, actor) {
  const err = validateInitiative(input);
  if (err) throw new Error(err);
  const { rows } = await query(
    `INSERT INTO finance.dept_budget_initiative
       (budget_id, name, kind, objective, owner, scope, classification, start_month, end_month, incremental_sales, incremental_margin, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING initiative_id`,
    [budgetId, input.name.trim(), input.kind || "INITIATIVE", input.objective || null, input.owner || null, input.scope || null,
     input.classification || "BAU", Number(input.start_month) || 1, Number(input.end_month) || 12,
     num(input.incremental_sales), num(input.incremental_margin), input.notes || null, actorOf(actor)]
  );
  const id = rows[0].initiative_id;
  await audit({ actor, eventType: "dept_budget.initiative.create", objectType: "dept_budget_initiative", objectRef: String(id), detail: { budgetId, name: input.name } });
  await resync(budgetId, actor);
  return { initiativeId: id };
}

const INIT_FIELDS = ["name", "kind", "objective", "owner", "scope", "classification", "start_month", "end_month", "incremental_sales", "incremental_margin", "notes"];

export async function updateInitiative(initiativeId, patch, actor) {
  const merged = { ...patch };
  const err = validateInitiative({ name: patch.name ?? "x", ...patch });
  if (patch.name !== undefined && err) throw new Error(err);
  const sets = [], vals = [];
  let i = 1;
  for (const f of INIT_FIELDS) if (f in merged) { sets.push(`${f} = $${i++}`); vals.push(merged[f] === "" ? null : merged[f]); }
  if (!sets.length) return { ok: true };
  vals.push(initiativeId);
  await query(`UPDATE finance.dept_budget_initiative SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE initiative_id = $${i}`, vals);
  const budgetId = await budgetIdOfInitiative(initiativeId);
  await audit({ actor, eventType: "dept_budget.initiative.update", objectType: "dept_budget_initiative", objectRef: String(initiativeId), detail: { fields: Object.keys(patch) } });
  if (budgetId) await resync(budgetId, actor);
  return { ok: true };
}

export async function deleteInitiative(initiativeId, actor) {
  const budgetId = await budgetIdOfInitiative(initiativeId);
  await query(`DELETE FROM finance.dept_budget_initiative WHERE initiative_id = $1`, [initiativeId]);
  await audit({ actor, eventType: "dept_budget.initiative.delete", objectType: "dept_budget_initiative", objectRef: String(initiativeId) });
  if (budgetId) await resync(budgetId, actor);
  return { ok: true };
}

// Replace an initiative's whole set of cost items, then resync the grid.
export async function saveInitiativeCosts(initiativeId, costs = [], actor) {
  await query(`DELETE FROM finance.dept_budget_initiative_cost WHERE initiative_id = $1`, [initiativeId]);
  let order = 0;
  for (const c of costs) {
    if (!String(c.line_label || "").trim()) continue;
    await query(
      `INSERT INTO finance.dept_budget_initiative_cost
         (initiative_id, category, line_label, amount, phasing, one_off_month, sort_order, ${MONTH_KEYS.join(", ")})
       VALUES ($1,$2,$3,$4,$5,$6,$7,${MONTH_KEYS.map((_, i) => `$${8 + i}`).join(", ")})`,
      [initiativeId, (c.category || "General").trim(), String(c.line_label).trim(), num(c.amount), c.phasing || "EVEN",
       c.one_off_month ? Number(c.one_off_month) : null, order, ...MONTH_KEYS.map((k) => num(c[k]))]
    );
    order += 10;
  }
  const budgetId = await budgetIdOfInitiative(initiativeId);
  await audit({ actor, eventType: "dept_budget.initiative.costs", objectType: "dept_budget_initiative", objectRef: String(initiativeId), detail: { costs: costs.length } });
  if (budgetId) await resync(budgetId, actor);
  return { ok: true };
}

export { budgetIdOfInitiative };
