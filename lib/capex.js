/*
 * Capex Investment — DB layer (migration 070). Reads/writes capex.project and
 * capex.allocation; all appraisal maths is in capex-rules.js. Each project's
 * multi-year model, NPV/IRR/payback and the portfolio consolidation are computed
 * on read. Degrades to []/null before the schema exists.
 */

import { query } from "./db";
import { audit } from "./governance";
import { projectModel, portfolio, capitalAllocation, clearsHurdle, INVESTMENT_TYPES } from "./capex-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const safe = async (fn, fb) => { try { return await fn(); } catch (e) { if (absent(e)) return fb; throw e; } };

// Map a DB row to the pure model input.
function modelInput(r) {
  return {
    investment: { fit_out: r.fit_out, fixtures: r.fixtures, it: r.it, inventory: r.inventory,
      professional_fees: r.professional_fees, marketing: r.marketing, working_capital: r.working_capital,
      contingency: r.contingency, other: r.other },
    // Occupancy is a recurring annual operating assumption, not upfront investment.
    rent: r.rent, business_rates: r.business_rates, service_charge: r.service_charge,
    years: r.years, year1_revenue: r.year1_revenue, revenue_growth_pct: r.revenue_growth_pct,
    gross_margin_pct: r.gross_margin_pct, payroll_pct: r.payroll_pct, opex_pct: r.opex_pct,
    payroll_fixed: r.payroll_fixed, opex_fixed: r.opex_fixed, depreciation_years: r.depreciation_years,
    depreciable_capex: r.depreciable_capex, tax_rate: r.tax_rate, discount_rate: r.discount_rate,
  };
}

const COLS = `project_id, name, investment_type, scenario_label, store_code, entity_id, region, opening_date,
  owner, status, priority, approval, fit_out, fixtures, it, inventory, professional_fees, marketing,
  working_capital, rent, business_rates, service_charge, contingency, other, years, year1_revenue, revenue_growth_pct, gross_margin_pct, payroll_pct,
  opex_pct, payroll_fixed, opex_fixed, depreciation_years, depreciable_capex, tax_rate, discount_rate,
  committed_amount, spent_amount, behind_schedule, over_budget, notes, created_by`;

export async function listProjects({ scenario = "BASE", status = null } = {}) {
  return safe(async () => {
    const { rows } = await query(
      `SELECT ${COLS} FROM capex.project
        WHERE ($1::varchar IS NULL OR scenario_label = $1) AND ($2::varchar IS NULL OR status = $2)
        ORDER BY priority NULLS LAST, name`, [scenario, status]);
    return rows.map((r) => ({ ...r, model: projectModel(modelInput(r)) }));
  }, []);
}

export async function getProject(id) {
  return safe(async () => {
    const { rows } = await query(`SELECT ${COLS} FROM capex.project WHERE project_id = $1`, [id]);
    if (!rows[0]) return null;
    return { ...rows[0], model: projectModel(modelInput(rows[0])) };
  }, null);
}

const NUM = ["priority", "fit_out", "fixtures", "it", "inventory", "professional_fees", "marketing", "working_capital",
  "rent", "business_rates", "service_charge",
  "contingency", "other", "years", "year1_revenue", "revenue_growth_pct", "gross_margin_pct", "payroll_pct", "opex_pct",
  "payroll_fixed", "opex_fixed", "depreciation_years", "depreciable_capex", "tax_rate", "discount_rate",
  "committed_amount", "spent_amount"];
const TXT = ["name", "investment_type", "scenario_label", "store_code", "region", "owner", "status", "approval", "notes"];
const BOOL = ["behind_schedule", "over_budget"];

export async function upsertProject(input, actor) {
  // Name is required to create a project, but an update (edit assumptions on an
  // existing project) may legitimately send only the changed fields — don't
  // reject a partial patch for missing name, or the edit silently never saves.
  if (!input.project_id && !input.name) throw new Error("Give the project a name");
  if (input.investment_type && !INVESTMENT_TYPES.includes(input.investment_type)) throw new Error("Choose a valid investment type");
  const cols = ["created_by"]; const vals = [actorOf(actor)];
  for (const k of TXT) if (input[k] !== undefined) { cols.push(k); vals.push(input[k] || null); }
  for (const k of NUM) if (input[k] !== undefined && input[k] !== "") { cols.push(k); vals.push(Number(input[k])); }
  for (const k of BOOL) if (input[k] !== undefined) { cols.push(k); vals.push(input[k] === true); }
  if (input.opening_date) { cols.push("opening_date"); vals.push(input.opening_date); }
  if (input.entity_id) { cols.push("entity_id"); vals.push(Number(input.entity_id)); }

  if (input.project_id) {
    const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE capex.project SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE project_id = $1`, [input.project_id, ...vals]);
    await audit({ actor, eventType: "capex.project.update", objectType: "capex_project", objectRef: String(input.project_id) });
    return { ok: true, projectId: input.project_id };
  }
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await query(`INSERT INTO capex.project (${cols.join(", ")}) VALUES (${ph}) RETURNING project_id`, vals);
  await audit({ actor, eventType: "capex.project.create", objectType: "capex_project", objectRef: String(rows[0].project_id), detail: { name: input.name } });
  return { ok: true, projectId: rows[0].project_id };
}

export async function deleteProject(id, actor) {
  await query(`DELETE FROM capex.project WHERE project_id = $1`, [id]);
  await audit({ actor, eventType: "capex.project.delete", objectType: "capex_project", objectRef: String(id) });
  return { ok: true };
}

export async function getAllocation(fiscalYear) {
  return safe(async () => (await query(
    `SELECT fiscal_year, capital_available, cash_available, hurdle_rate, notes FROM capex.allocation WHERE fiscal_year = $1`, [fiscalYear])).rows[0]
    || { fiscal_year: fiscalYear, capital_available: 0, cash_available: 0, hurdle_rate: 0.15 }, { fiscal_year: fiscalYear, capital_available: 0, cash_available: 0, hurdle_rate: 0.15 });
}

export async function setAllocation(input, actor) {
  await query(
    `INSERT INTO capex.allocation (fiscal_year, capital_available, cash_available, hurdle_rate, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
     ON CONFLICT (fiscal_year) DO UPDATE SET capital_available = EXCLUDED.capital_available,
       cash_available = EXCLUDED.cash_available, hurdle_rate = EXCLUDED.hurdle_rate, notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [Number(input.fiscal_year), Number(input.capital_available) || 0, Number(input.cash_available) || 0,
     input.hurdle_rate == null ? 0.15 : Number(input.hurdle_rate), input.notes || null, actorOf(actor)]);
  await audit({ actor, eventType: "capex.allocation.set", objectType: "capex_allocation", objectRef: String(input.fiscal_year) });
  return { ok: true };
}

// The portfolio view: every project (excluding ON_HOLD) consolidated, plus the
// capital-allocation position and a per-project hurdle check.
export async function getPortfolio({ scenario = "BASE", fiscalYear = null } = {}) {
  const projects = await listProjects({ scenario });
  const active = projects.filter((p) => p.status !== "ON_HOLD" && p.status !== "COMPLETE");
  const models = active.map((p) => p.model);
  const port = portfolio(models, { discountRate: 0.1 });
  const alloc = fiscalYear != null ? await getAllocation(fiscalYear) : null;
  const committed = projects.reduce((t, p) => t + Number(p.committed_amount || 0), 0);
  const allocation = alloc ? capitalAllocation({ capitalAvailable: alloc.capital_available, committed, cashAvailable: alloc.cash_available }, port) : null;
  const hurdle = alloc ? Number(alloc.hurdle_rate) : 0.15;
  const rows = projects.map((p) => ({
    project_id: p.project_id, name: p.name, investment_type: p.investment_type, status: p.status, region: p.region,
    totalInvestment: p.model.summary.totalInvestment, irr: p.model.summary.irr, npv: p.model.summary.npv,
    payback: p.model.summary.payback, avgEbitdaMargin: p.model.summary.avgEbitdaMargin,
    clearsHurdle: clearsHurdle(p.model.summary, hurdle), behind_schedule: p.behind_schedule, over_budget: p.over_budget,
    committed_amount: p.committed_amount, spent_amount: p.spent_amount,
  }));
  return { portfolio: port, allocation, projects: rows, hurdleRate: hurdle };
}
