import { query } from "./db";
import { audit } from "./governance";
import {
  MONTH_KEYS, validateBudget, validateLine, budgetTransitionError, isEditableBudget,
  BUDGET_TRANSITIONS, normBudgetType,
} from "./dept-budget-rules.js";
import { SEED_OBJECTIVES, zeroBasedDetail, commercialSummary, initiativeInvestment, objectiveOutcome } from "./dept-initiative-rules.js";

/*
 * Departmental Budgets — DB layer. A department head creates a budget (seeded
 * from the department's starter template), edits the cost-line grid while it is
 * a DRAFT, then moves it through the approval chain (Finance Review → Department
 * Approval → SLT Approval → Locked). The grid maths and the state machine live in
 * dept-budget-rules.js; this layer is the reads and writes. Degrades to
 * { ready:false } before migration 049 (42P01), and every mutation is audited.
 * A per-budget event timeline (migration 050) records each transition.
 */

const tableMissing = (e) => e?.code === "42P01";
const missing = (e) => e?.code === "42P01" || e?.code === "42703";
const actorOf = (a) => a?.email || a?.name || "system";
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function listBudgets({ department = null, year = null } = {}) {
  const base = `WHERE ($1::varchar IS NULL OR b.department = $1)
                  AND ($2::int IS NULL OR b.budget_year = $2)
                ORDER BY b.budget_year DESC, b.department, b.version_label`;
  try {
    try {
      // post-102: carry the budget type + the linked Business Project's name
      const { rows } = await query(
        `SELECT b.budget_id, b.department, b.budget_year, b.version_label, b.status, b.created_by,
                b.created_at, b.updated_at, b.submitted_by, b.submitted_at, b.approved_by, b.approved_at,
                b.budget_type, b.business_project_id, bp.name AS project_name
           FROM finance.dept_budget b
           LEFT JOIN finance.business_project bp ON bp.business_project_id = b.business_project_id
           ${base}`,
        [department, year]
      );
      return { ready: true, budgets: rows };
    } catch (e0) {
      if (e0?.code !== "42703") throw e0;   // pre-102: no budget_type / business_project_id
      const { rows } = await query(
        `SELECT b.budget_id, b.department, b.budget_year, b.version_label, b.status, b.created_by,
                b.created_at, b.updated_at, b.submitted_by, b.submitted_at, b.approved_by, b.approved_at
           FROM finance.dept_budget b ${base}`,
        [department, year]
      );
      return { ready: true, budgets: rows.map((r) => ({ ...r, budget_type: "BUSINESS", business_project_id: null, project_name: null })) };
    }
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
    // Attach the linked Business Project's name for a PROJECT budget (best-effort).
    if (budget.business_project_id) {
      try {
        const { rows: pr } = await query(`SELECT name FROM finance.business_project WHERE business_project_id = $1`, [budget.business_project_id]);
        budget.project_name = pr[0]?.name || null;
      } catch { budget.project_name = null; }
    }
    // SELECT * so optional columns (commentary/source/classification, added by
    // migrations 050–051) come through when present without brittle column lists.
    const { rows: lines } = await query(
      `SELECT * FROM finance.dept_budget_line WHERE budget_id = $1 ORDER BY sort_order, line_id`, [budgetId]);
    const events = await listEvents(budgetId);
    return { budget, lines, events };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}

// The approval timeline (migration 050). Empty before it's applied.
export async function listEvents(budgetId) {
  try {
    const { rows } = await query(
      `SELECT event_type, from_status, to_status, actor, note, created_at
       FROM finance.dept_budget_event WHERE budget_id = $1 ORDER BY created_at`, [budgetId]);
    return rows;
  } catch (e) { if (missing(e)) return []; throw e; }
}

// Set the top-down budget target (the spending envelope). Finance/Admin only —
// gated in the API.
export async function setTarget(budgetId, amount, actor) {
  try {
    await query(`UPDATE finance.dept_budget SET target_amount = $2, updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`,
      [budgetId, amount == null || amount === "" ? null : Number(amount)]);
  } catch (e) { if (e?.code === "42703") throw new Error("Run migration 050 to set a budget target"); throw e; }
  await audit({ actor, eventType: "dept_budget.set_target", objectType: "dept_budget", objectRef: String(budgetId), detail: { amount } });
  return { ok: true };
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
export async function createBudget({ department, budget_year, version_label, budget_type, business_project_id }, actor) {
  const err = validateBudget({ department, budget_year, budget_type, business_project_id });
  if (err) throw new Error(err);
  const type = normBudgetType(budget_type);
  const projectId = type === "PROJECT" && Number(business_project_id) > 0 ? Number(business_project_id) : null;
  let budgetId;
  try {
    try {
      // post-102: business/project type + optional Business Project link
      const { rows } = await query(
        `INSERT INTO finance.dept_budget (department, budget_year, version_label, budget_type, business_project_id, created_by)
         VALUES ($1,$2,COALESCE(NULLIF($3,''),'Working draft'),$4,$5,$6) RETURNING budget_id`,
        [department.trim(), Number(budget_year), version_label || null, type, projectId, actorOf(actor)]
      );
      budgetId = rows[0].budget_id;
    } catch (e0) {
      if (e0?.code !== "42703") throw e0;   // pre-102: no budget_type / business_project_id
      const { rows } = await query(
        `INSERT INTO finance.dept_budget (department, budget_year, version_label, created_by)
         VALUES ($1,$2,COALESCE(NULLIF($3,''),'Working draft'),$4) RETURNING budget_id`,
        [department.trim(), Number(budget_year), version_label || null, actorOf(actor)]
      );
      budgetId = rows[0].budget_id;
    }
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
  await audit({ actor, eventType: "dept_budget.create", objectType: "dept_budget", objectRef: String(budgetId), detail: { department, budget_year, budget_type: type, business_project_id: projectId, seeded: tpl.length } });
  return { budgetId };
}

async function requireEditable(budgetId) {
  const { rows } = await query(`SELECT status FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  if (!rows.length) throw new Error("Budget not found");
  if (!isEditableBudget(rows[0].status)) throw new Error(`This budget is ${rows[0].status.toLowerCase()} and cannot be edited — reopen it first`);
  return rows[0].status;
}

// Which optional columns exist (progressive migrations 050/051).
async function lineColumns() {
  let hasCommentary = false, hasSource = false;
  try { await query(`SELECT commentary FROM finance.dept_budget_line LIMIT 0`); hasCommentary = true; } catch (e) { if (e?.code !== "42703") throw e; }
  try { await query(`SELECT source, classification FROM finance.dept_budget_line LIMIT 0`); hasSource = true; } catch (e) { if (e?.code !== "42703") throw e; }
  return { hasCommentary, hasSource };
}

// Insert one grid line with whatever optional columns exist. `source` ∈ MANUAL|INITIATIVE.
async function insertLine(budgetId, l, order, cols, source = "MANUAL") {
  const names = ["budget_id", "category", "line_label", "sort_order", "prior_year"];
  const vals = [budgetId, (l.category || "General").trim(), String(l.line_label).trim(), l.sort_order ?? order, num(l.prior_year)];
  if (cols.hasCommentary) { names.push("commentary"); vals.push(String(l.commentary || "").trim() || null); }
  if (cols.hasSource) { names.push("source", "classification"); vals.push(source, l.classification || null); }
  names.push(...MONTH_KEYS); vals.push(...MONTH_KEYS.map((k) => num(l[k])));
  const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
  await query(`INSERT INTO finance.dept_budget_line (${names.join(", ")}) VALUES (${ph})`, vals);
}

/*
 * Replace the MANUAL cost lines for a DRAFT budget from the UI payload. Lines
 * generated from initiatives (source = INITIATIVE) are preserved — they are
 * owned by the operational-planning layer (syncFinancialLines).
 */
export async function saveLines(budgetId, lines = [], actor) {
  await requireEditable(budgetId);
  for (const l of lines) { const err = validateLine(l); if (err) throw new Error(err); }
  const cols = await lineColumns();
  if (cols.hasSource) await query(`DELETE FROM finance.dept_budget_line WHERE budget_id = $1 AND (source IS NULL OR source = 'MANUAL')`, [budgetId]);
  else await query(`DELETE FROM finance.dept_budget_line WHERE budget_id = $1`, [budgetId]);
  let order = 0;
  for (const l of lines) { await insertLine(budgetId, l, order, cols, "MANUAL"); order += 10; }
  await query(`UPDATE finance.dept_budget SET updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`, [budgetId]);
  await audit({ actor, eventType: "dept_budget.save_lines", objectType: "dept_budget", objectRef: String(budgetId), detail: { lines: lines.length } });
  return { ok: true };
}

// Replace the INITIATIVE-generated grid lines from the current initiatives
// (DRAFT only). Manual lines are untouched. Used after any initiative change.
export async function syncFinancialLines(budgetId, generated = [], actor) {
  await requireEditable(budgetId);
  const cols = await lineColumns();
  if (!cols.hasSource) throw new Error("Run migration 051 to generate financial lines from initiatives");
  await query(`DELETE FROM finance.dept_budget_line WHERE budget_id = $1 AND source = 'INITIATIVE'`, [budgetId]);
  // place generated lines after the manual ones
  const { rows } = await query(`SELECT COALESCE(max(sort_order),0) AS n FROM finance.dept_budget_line WHERE budget_id = $1`, [budgetId]);
  let order = Number(rows[0].n) + 10;
  for (const l of generated) { await insertLine(budgetId, l, order, cols, "INITIATIVE"); order += 10; }
  await query(`UPDATE finance.dept_budget SET updated_at = CURRENT_TIMESTAMP WHERE budget_id = $1`, [budgetId]);
  await audit({ actor, eventType: "dept_budget.sync_lines", objectType: "dept_budget", objectRef: String(budgetId), detail: { generated: generated.length } });
  return { ok: true, generated: generated.length };
}

// Record a timeline event (best-effort; never blocks the transition).
async function recordEvent(budgetId, { eventType, from = null, to = null, note = null, actor }) {
  try {
    await query(
      `INSERT INTO finance.dept_budget_event (budget_id, event_type, from_status, to_status, actor, note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [budgetId, eventType, from, to, actorOf(actor), note || null]
    );
  } catch (e) { if (!missing(e)) console.error("dept_budget event write failed:", e.message); }
}

async function statusOf(budgetId) {
  const { rows } = await query(`SELECT status FROM finance.dept_budget WHERE budget_id = $1`, [budgetId]);
  if (!rows.length) throw new Error("Budget not found");
  return rows[0].status;
}

/*
 * Run one workflow transition (the role check is done in the API, where the
 * session and the department's approver list are known). Records a timeline event
 * and stamps the relevant approver columns. `action` is one of BUDGET_TRANSITIONS.
 */
export async function transitionBudget(budgetId, action, { note = null } = {}, actor) {
  const from = await statusOf(budgetId);
  const err = budgetTransitionError(action, from);
  if (err) throw new Error(err);
  const to = BUDGET_TRANSITIONS[action].to;

  // Stamp the stage's approver columns for quick display. $3 = actor (only used
  // when a transition sets an approver name).
  const set = ["status = $2", "updated_at = CURRENT_TIMESTAMP"];
  const params = [budgetId, to];
  if (action === "submit_to_finance" || action === "slt_approve") {
    const col = action === "slt_approve" ? "approved" : "submitted";
    params.push(actorOf(actor));
    set.push(`${col}_by = $3`, `${col}_at = CURRENT_TIMESTAMP`);
  }
  if (to === "DRAFT") set.push("approved_by = NULL", "approved_at = NULL");

  await query(`UPDATE finance.dept_budget SET ${set.join(", ")} WHERE budget_id = $1`, params);
  await recordEvent(budgetId, { eventType: action, from, to, note, actor });
  await audit({ actor, eventType: `dept_budget.${action}`, objectType: "dept_budget", objectRef: String(budgetId), detail: { from, to } });
  return { ok: true, status: to };
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

// ---- Initiative objectives (shared list, migration 059) --------------------

// The objective options for the create-form dropdown. Reads the shared list;
// falls back to the seeded nine before migration 059 is applied.
export async function listObjectives() {
  try {
    const { rows } = await query(
      `SELECT label FROM finance.dept_budget_objective WHERE is_active ORDER BY sort_order, label`);
    return rows.length ? rows.map((r) => r.label) : SEED_OBJECTIVES;
  } catch (e) {
    if (missing(e)) return SEED_OBJECTIVES;
    throw e;
  }
}

// Append a new objective to the shared list ("+ Add new"). Idempotent on label.
export async function addObjective(label, actor) {
  const clean = String(label || "").trim();
  if (!clean) throw new Error("Give the objective a name");
  if (clean.length > 160) throw new Error("Objective is too long");
  try {
    await query(
      `INSERT INTO finance.dept_budget_objective (label, sort_order, created_by)
       VALUES ($1, 500, $2) ON CONFLICT (label) DO NOTHING`,
      [clean, actorOf(actor)]);
  } catch (e) { if (missing(e)) throw new Error("Run migration 059 to add objectives"); throw e; }
  await audit({ actor, eventType: "dept_budget.objective.add", objectType: "dept_budget_objective", objectRef: clean });
  return { ok: true, label: clean, objectives: await listObjectives() };
}

// ---- Departmental budget report (Reporting Centre source) ------------------

// The latest budget id for a department (most recent year, then most recently
// touched) — what the report shows when only a department is given.
async function latestBudgetIdForDept(department) {
  const { rows } = await query(
    `SELECT budget_id FROM finance.dept_budget WHERE department = $1
     ORDER BY budget_year DESC, updated_at DESC LIMIT 1`, [department]);
  return rows[0]?.budget_id || null;
}

// The most recently touched budget across all departments — the fallback when a
// report section names no department (the template seed can't know which one).
async function latestBudgetIdAny() {
  const { rows } = await query(
    `SELECT budget_id FROM finance.dept_budget ORDER BY budget_year DESC, updated_at DESC LIMIT 1`);
  return rows[0]?.budget_id || null;
}

// Initiatives (with their cost items) for a budget — a local read so this module
// doesn't import dept-initiative.js (which imports back into this one).
async function initiativesWithCosts(budgetId) {
  const { rows: inits } = await query(
    `SELECT * FROM finance.dept_budget_initiative WHERE budget_id = $1 ORDER BY sort_order, initiative_id`, [budgetId]);
  if (!inits.length) return [];
  const { rows: costs } = await query(
    `SELECT * FROM finance.dept_budget_initiative_cost WHERE initiative_id = ANY($1::bigint[]) ORDER BY sort_order, cost_id`,
    [inits.map((i) => i.initiative_id)]);
  const byInit = new Map(inits.map((i) => [i.initiative_id, { ...i, costs: [] }]));
  for (const c of costs) byInit.get(c.initiative_id)?.costs.push(c);
  return [...byInit.values()];
}

/*
 * Everything the Corporate Reporting Centre needs to present a department's budget
 * to the SLT: the target/planned/variance envelope, the commercial roll-up
 * (investment, incremental sales & margin, contribution), the initiatives with
 * their objectives, and the full zero-based cost detail (driver × qty × unit cost).
 * Pass a budgetId, or a department to take its latest budget.
 */
export async function getDeptBudgetReport({ department = null, budgetId = null } = {}) {
  try {
    // Resolve the budget to report on: an explicit budgetId, else the named
    // department's latest, else the latest across all departments. If a department
    // was asked for but has no budget, still fall back to the latest available one
    // so the pack renders something useful instead of an empty "No data" pack.
    let id = budgetId || (department ? await latestBudgetIdForDept(department) : null);
    let scopedFallback = false;
    if (!id) {
      id = await latestBudgetIdAny();
      scopedFallback = Boolean(department) && Boolean(id);
    }
    if (!id) return { ready: false, reason: department ? `No budget found for ${department}, and none exist yet.` : "No departmental budget has been created yet." };
    const loaded = await getBudget(id);
    if (!loaded) return { ready: false, reason: "Budget not found." };
    const { budget, lines } = loaded;
    const inits = await initiativesWithCosts(id);

    const planned = round2(lines.reduce((t, l) => t + MONTH_KEYS.reduce((s, k) => s + num(l[k]), 0), 0));
    const target = budget.target_amount != null ? Number(budget.target_amount) : null;
    const commercial = commercialSummary(inits);
    const zbb = zeroBasedDetail(inits);

    return {
      ready: true,
      budget: { budgetId: id, department: budget.department, year: budget.budget_year, version: budget.version_label, status: budget.status, scopedFallback },
      summary: {
        target, planned,
        variance: target != null ? round2(target - planned) : null,
        investment: commercial.investment,
        incrementalSales: commercial.incrementalSales,
        incrementalMargin: commercial.incrementalMargin,
        contribution: commercial.contribution,
      },
      initiatives: inits.map((i) => {
        const oc = objectiveOutcome(i.objective);
        const outcomeText = oc.kind === "text"
          ? (i.outcome_note || null)
          : (i.outcome_value != null
              ? (oc.unit === "£"
                  ? `£${Number(i.outcome_value).toLocaleString("en-GB")}`
                  : `${Number(i.outcome_value).toLocaleString("en-GB")}${oc.unit ? ` ${oc.unit}` : ""}`)
              : null);
        return {
          name: i.name, objective: i.objective || null, kind: i.kind, classification: i.classification,
          owner: i.owner || null, start_month: i.start_month, end_month: i.end_month,
          investment: initiativeInvestment(i),
          incremental_sales: num(i.incremental_sales), incremental_margin: num(i.incremental_margin),
          outcome: { label: oc.label, value: i.outcome_value != null ? Number(i.outcome_value) : null, unit: oc.unit || null, note: i.outcome_note || null, display: outcomeText },
        };
      }),
      zbb,
    };
  } catch (e) {
    if (missing(e)) return { ready: false, reason: "Departmental budget tables not migrated yet." };
    throw e;
  }
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
