import { query } from "./db";
import { classifyEntity } from "./pl-format.js";
import { getForecast } from "./forecast.js";
import { computeForecast } from "./forecast-rules.js";
import { getVersion, getVersionLines, getLatestApproved } from "./forecast-versions.js";
import { SCOPE_MAP, BELOW_EBITDA, ebitda, assembleDashboard } from "./ma-dashboard-rules.js";

/*
 * Management Accounts dashboard — DB layer. Actuals come from the per-entity
 * P&L (finance.joiin_pl_entity), the same feed behind Perform → Management
 * Accounts; forecast from the PLAN Forecast Builder (computeForecast). We
 * classify each entity to a scope (store / head office / franchise) exactly as
 * the Perform views do, aggregate its sections into { revenue, ebitda } per
 * month (excluding below-EBITDA lines so it matches the forecast basis), then
 * the pure assembleDashboard does the comparison.
 */

export { SCOPE_MAP };
const tableMissing = (e) => e?.code === "42P01";
const SECTION_KEY = { "Revenue": "revenue", "Cost of Sales": "cogs", "Expenses": "expenses", "Other Income": "otherIncome", "Other Expenses": "otherExpenses" };

async function actualsFromEntities() {
  let rows;
  try {
    ({ rows } = await query(`SELECT entity_id, entity_name, section, account, ym, value FROM finance.joiin_pl_entity`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, byScope: {} };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false, byScope: {} };

  // Classify each entity to a scope, mirroring getScopePnl.
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.entity_id)) byId.set(r.entity_id, { name: r.entity_name, accounts: new Set() });
    byId.get(r.entity_id).accounts.add(r.account);
  }
  const scopeOf = {};
  for (const [id, e] of byId) {
    if (classifyEntity(e.name, [...e.accounts]) === "store") scopeOf[id] = "store";
    else if (e.name === "Kouriten Limited") scopeOf[id] = "head_office";
    else if (/franchise/i.test(e.name)) scopeOf[id] = "franchise";
    // holdings / e-com / group entities are not one of the three scopes — skipped
  }

  // scope → ym → section sums (excluding below-EBITDA accounts from cost lines).
  const acc = {};
  for (const r of rows) {
    const sc = scopeOf[r.entity_id];
    if (!sc) continue;
    const key = SECTION_KEY[r.section];
    if (!key) continue;
    if ((key === "expenses" || key === "otherExpenses") && BELOW_EBITDA.test(r.account)) continue;
    const m = ((acc[sc] ||= {})[r.ym] ||= { revenue: 0, cogs: 0, expenses: 0, otherIncome: 0, otherExpenses: 0 });
    m[key] += Number(r.value);
  }

  const byScope = {};
  for (const def of SCOPE_MAP) {
    const m = acc[def.scope] || {};
    const months = Object.keys(m).sort();
    const byMonth = {};
    for (const ym of months) byMonth[ym] = { revenue: m[ym].revenue, ebitda: ebitda(m[ym]) };
    byScope[def.scope] = { loaded: months.length > 0, months, years: [...new Set(months.map((x) => x.slice(0, 4)))].sort(), byMonth };
  }
  return { ready: true, loaded: Object.values(byScope).some((s) => s.loaded), byScope };
}

// Load a budget snapshot to compare against: an explicit version if given, else
// the latest approved BUDGET. Returns { budget, meta } where budget is a
// computeForecast()-shaped object (or null) and meta describes the source for
// the UI. Never throws — a missing versions table just means "no budget".
async function loadBudget(budgetVersionId) {
  try {
    if (budgetVersionId) {
      const [version, lines] = await Promise.all([getVersion(budgetVersionId), getVersionLines(budgetVersionId)]);
      if (!version || !lines.length) return { budget: null, meta: null };
      return { budget: computeForecast(lines), meta: { id: version.version_id, label: version.label, status: version.status } };
    }
    const latest = await getLatestApproved("BUDGET");
    if (!latest || !latest.lines.length) return { budget: null, meta: null };
    return { budget: computeForecast(latest.lines), meta: { id: latest.version.version_id, label: latest.version.label, status: latest.version.status } };
  } catch (e) {
    if (e?.code === "42P01") return { budget: null, meta: null }; // versions table not migrated yet
    throw e;
  }
}

// period: "current" | "ytd". year: "YYYY" (defaults to the latest with actuals).
// compare: "forecast" | "budget" | "priorYear". budgetVersionId: pin a specific
// budget version (otherwise the latest approved budget is used).
export async function getMaDashboard({ period = "current", year = null, compare = "forecast", budgetVersionId = null } = {}) {
  const fc = await getForecast();
  const forecast = fc.loaded ? computeForecast(fc.lines) : null;
  const act = await actualsFromEntities();
  const { budget, meta: budgetMeta } = await loadBudget(budgetVersionId);

  const diag = `actuals:${act.ready ? (act.loaded ? "loaded" : "empty") : "no-table"} · forecast:${fc.loaded ? "loaded" : fc.ready ? "empty" : "no-table"} · budget:${budget ? "loaded" : "none"}`;
  if (!act.ready) return { ready: false, loaded: false, forecastLoaded: fc.loaded, budgetLoaded: !!budget, budgetMeta, diag };
  if (!act.loaded) return { ready: true, loaded: false, forecastLoaded: fc.loaded, budgetLoaded: !!budget, budgetMeta, diag };

  const built = assembleDashboard(act.byScope, forecast, period, year, { budget, compare });
  return { ready: true, loaded: true, forecastLoaded: fc.loaded, budgetLoaded: !!budget, budgetMeta, diag, ...built };
}
