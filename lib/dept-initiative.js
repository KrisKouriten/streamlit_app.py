import { query } from "./db";
import { audit } from "./governance";
import { syncFinancialLines } from "./dept-budget";
import { MONTH_KEYS, generateLines, validateInitiative, costAmount, objectiveOutcome } from "./dept-initiative-rules.js";

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

// Whether the objective-driven outcome columns exist yet (migration 060).
async function initiativeHasOutcome() {
  try { await query(`SELECT outcome_value FROM finance.dept_budget_initiative LIMIT 0`); return true; }
  catch (e) { if (e?.code === "42703") return false; throw e; }
}

/*
 * Derive the stored commercial + outcome columns from the chosen objective and the
 * single expected-outcome input. For £ objectives the value feeds incremental
 * sales / margin (so contribution still works); for count/rate objectives it lands
 * in outcome_value + its unit; for free-text objectives it lands in outcome_note.
 */
function deriveOutcome(objective, outcomeValue, outcomeNote) {
  const oc = objectiveOutcome(objective);
  if (oc.kind === "text") {
    return { incremental_sales: 0, incremental_margin: 0, outcome_value: null, outcome_unit: null,
      outcome_note: (outcomeNote != null && String(outcomeNote).trim()) || null };
  }
  const v = outcomeValue === "" || outcomeValue == null ? null : num(outcomeValue);
  return {
    incremental_sales: oc.key === "sales" ? (v || 0) : 0,
    incremental_margin: oc.key === "margin" ? (v || 0) : 0,
    outcome_value: v, outcome_unit: oc.unit || null, outcome_note: null,
  };
}

export async function createInitiative(budgetId, input, actor) {
  const err = validateInitiative(input);
  if (err) throw new Error(err);
  const oc = deriveOutcome(input.objective, input.outcome_value, input.outcome_note);
  const hasOutcome = await initiativeHasOutcome();
  const names = ["budget_id", "name", "kind", "objective", "owner", "scope", "classification", "start_month", "end_month", "incremental_sales", "incremental_margin", "notes", "created_by"];
  const vals = [budgetId, input.name.trim(), input.kind || "INITIATIVE", input.objective || null, input.owner || null, input.scope || null,
    input.classification || "BAU", Number(input.start_month) || 1, Number(input.end_month) || 12,
    oc.incremental_sales, oc.incremental_margin, input.notes || null, actorOf(actor)];
  if (hasOutcome) { names.push("outcome_value", "outcome_unit", "outcome_note"); vals.push(oc.outcome_value, oc.outcome_unit, oc.outcome_note); }
  const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await query(
    `INSERT INTO finance.dept_budget_initiative (${names.join(", ")}) VALUES (${ph}) RETURNING initiative_id`, vals);
  const id = rows[0].initiative_id;
  await audit({ actor, eventType: "dept_budget.initiative.create", objectType: "dept_budget_initiative", objectRef: String(id), detail: { budgetId, name: input.name } });
  await resync(budgetId, actor);
  return { initiativeId: id };
}

const INIT_FIELDS = ["name", "kind", "objective", "owner", "scope", "classification", "start_month", "end_month", "incremental_sales", "incremental_margin", "notes"];

export async function updateInitiative(initiativeId, patch, actor) {
  const err = validateInitiative({ name: patch.name ?? "x", ...patch });
  if (patch.name !== undefined && err) throw new Error(err);
  const merged = { ...patch };
  // When the outcome inputs are present, derive the commercial + outcome columns.
  if ("objective" in patch || "outcome_value" in patch || "outcome_note" in patch) {
    Object.assign(merged, deriveOutcome(patch.objective, patch.outcome_value, patch.outcome_note));
  }
  const fields = [...INIT_FIELDS];
  if (await initiativeHasOutcome()) fields.push("outcome_value", "outcome_unit", "outcome_note");
  const sets = [], vals = [];
  let i = 1;
  for (const f of fields) if (f in merged) { sets.push(`${f} = $${i++}`); vals.push(merged[f] === "" ? null : merged[f]); }
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

// Whether the zero-based build-up columns exist yet (migration 059).
async function costHasZbb() {
  try { await query(`SELECT driver FROM finance.dept_budget_initiative_cost LIMIT 0`); return true; }
  catch (e) { if (e?.code === "42703") return false; throw e; }
}

// Replace an initiative's whole set of cost items, then resync the grid. The
// stored `amount` is the effective (zero-based) amount — quantity × unit cost when
// a build-up is given, else the lump sum — so the grid and the report agree.
export async function saveInitiativeCosts(initiativeId, costs = [], actor) {
  const zbb = await costHasZbb();
  await query(`DELETE FROM finance.dept_budget_initiative_cost WHERE initiative_id = $1`, [initiativeId]);
  let order = 0;
  for (const c of costs) {
    if (!String(c.line_label || "").trim()) continue;
    const names = ["initiative_id", "category", "line_label", "amount", "phasing", "one_off_month", "sort_order"];
    const vals = [initiativeId, (c.category || "General").trim(), String(c.line_label).trim(), costAmount(c), c.phasing || "EVEN",
      c.one_off_month ? Number(c.one_off_month) : null, order];
    if (zbb) {
      names.push("driver", "quantity", "unit_cost");
      vals.push(
        c.driver ? String(c.driver).trim() : null,
        c.quantity === "" || c.quantity == null ? null : num(c.quantity),
        c.unit_cost === "" || c.unit_cost == null ? null : num(c.unit_cost));
    }
    names.push(...MONTH_KEYS); vals.push(...MONTH_KEYS.map((k) => num(c[k])));
    const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
    await query(`INSERT INTO finance.dept_budget_initiative_cost (${names.join(", ")}) VALUES (${ph})`, vals);
    order += 10;
  }
  const budgetId = await budgetIdOfInitiative(initiativeId);
  await audit({ actor, eventType: "dept_budget.initiative.costs", objectType: "dept_budget_initiative", objectRef: String(initiativeId), detail: { costs: costs.length } });
  if (budgetId) await resync(budgetId, actor);
  return { ok: true };
}

export { budgetIdOfInitiative };
