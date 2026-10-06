import { query } from "./db";
import { ECOM_SQL, ecomPnlMonth, monthsOfYear } from "./ecom-rules.js";
import { windowsFromMaxDate, monthWindow } from "./store-sales";

/*
 * E-COM reporting — data access. The daily figures are the E-COM line of the
 * store sales sheet (commercial.fact_store_sales, picked out by ECOM_SQL); the
 * forecast is the same live sales forecast the store dashboards use; fees and
 * marketing come from the E-Commerce entity's monthly management accounts.
 * Every reader degrades to empty rather than throwing, so a missing feed reads
 * as "not loaded" on the page instead of an error.
 */

const ACTUAL = "sc.scenario_type = 'ACTUAL'";
const FC = `sc.scenario_id = COALESCE(
  (SELECT scenario_id FROM core.dim_scenario
    WHERE scenario_code LIKE 'SALES-FC-%' AND status = 'APPROVED'
    ORDER BY approved_at DESC NULLS LAST, version_number DESC LIMIT 1),
  (SELECT scenario_id FROM core.dim_scenario WHERE scenario_code = 'STORE-FC-2026'))`;
const FROM = `FROM commercial.fact_store_sales s
  JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
  JOIN core.dim_store st ON st.store_id = s.store_id`;
const MEASURES = `COALESCE(SUM(s.net_sales),0) AS net, COALESCE(SUM(s.gross_sales),0) AS gross,
  COALESCE(SUM(s.gross_margin),0) AS gm, COALESCE(SUM(s.transactions),0) AS orders,
  COALESCE(SUM(s.units_sold),0) AS units, COALESCE(SUM(s.footfall),0) AS sessions,
  COALESCE(SUM(s.return_transactions),0) AS return_orders, COALESCE(SUM(s.return_value),0) AS return_value,
  COUNT(DISTINCT s.date_key) AS days`;

// The E-Commerce entity in Joiin (lib/entity-map.js).
export const ECOM_JOIIN_ENTITY_ID = "6bb08e30-d0cd-11ee-a002-abfc6416826b";

const n = (v) => Number(v) || 0;
// The latest trading day less 365 days — where last year stops for the month in progress.
const lyCap = (maxDate) => (maxDate ? new Date(new Date(String(maxDate).slice(0, 10) + "T00:00:00Z").getTime() - 365 * 86400000).toISOString().slice(0, 10) : null);
const totals = (r = {}) => ({
  net: n(r.net), gross: n(r.gross), gm: n(r.gm), orders: n(r.orders), units: n(r.units),
  sessions: n(r.sessions), returnOrders: n(r.return_orders), returnValue: n(r.return_value), days: n(r.days),
});

// The store lines being read as E-COM, and the latest day of E-COM data.
export async function getEcomFeed() {
  try {
    const [{ rows: stores }, { rows: max }] = await Promise.all([
      query(`SELECT st.store_id, st.store_code, st.store_name FROM core.dim_store st WHERE ${ECOM_SQL} ORDER BY st.store_name`),
      query(`SELECT MAX(d.calendar_date) AS max_date ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
              WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day`),
    ]);
    const windows = windowsFromMaxDate(max[0]?.max_date);
    return { ready: true, stores, windows, maxDate: windows?.maxDate || null };
  } catch { return { ready: false, stores: [], windows: null, maxDate: null }; }
}

/*
 * One window: this year, the same dates last year (−365 days) and the live
 * forecast, plus all company stores for E-COM's share of company sales.
 */
export async function getEcomPeriod(win) {
  const [cy, py, fc, co] = await Promise.all([
    query(`SELECT ${MEASURES} ${FROM} WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2`, [win.from, win.to]),
    query(`SELECT ${MEASURES} ${FROM} WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2`, [win.pyFrom, win.pyTo]),
    query(`SELECT COALESCE(SUM(s.net_sales),0) AS net ${FROM} WHERE ${FC} AND ${ECOM_SQL} AND s.date_key BETWEEN $1 AND $2`, [win.from, win.to]),
    query(`SELECT COALESCE(SUM(s.net_sales),0) AS net ${FROM}
            WHERE ${ACTUAL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
              AND st.operator_name IS NOT NULL AND st.ownership_type = 'COMPANY' AND NOT ${ECOM_SQL}`, [win.from, win.to]),
  ]);
  return { cy: totals(cy.rows[0]), py: totals(py.rows[0]), forecast: n(fc.rows[0]?.net), companyStores: n(co.rows[0]?.net) };
}

/*
 * By month for a calendar year: actual, last year and forecast, with orders,
 * units, sessions and margin for the KPIs. For the month still trading, last
 * year stops at the same date (the latest day − 365), so a part month is never
 * set against a whole one.
 *   → [{ ym, actual: totals, py: totals, forecast }]
 */
export async function getEcomMonthly(year, maxDate = null) {
  const y = Number(year);
  const byMonth = `to_char(d.calendar_date,'YYYY-MM')`;
  const [act, prior, fc] = await Promise.all([
    query(`SELECT ${byMonth} AS ym, ${MEASURES} ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
            WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2 GROUP BY 1`, [y * 10000 + 101, y * 10000 + 1231]),
    query(`SELECT ${byMonth} AS ym, ${MEASURES} ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
            WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
              AND NOT ($3::date IS NOT NULL AND ${byMonth} = to_char($3::date, 'YYYY-MM') AND d.calendar_date > $3::date)
            GROUP BY 1`, [(y - 1) * 10000 + 101, (y - 1) * 10000 + 1231, lyCap(maxDate)]),
    query(`SELECT ${byMonth} AS ym, COALESCE(SUM(s.net_sales),0) AS net ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
            WHERE ${FC} AND ${ECOM_SQL} AND s.date_key BETWEEN $1 AND $2 GROUP BY 1`, [y * 10000 + 101, y * 10000 + 1231]),
  ]).catch(() => [{ rows: [] }, { rows: [] }, { rows: [] }]);
  // The forecast for the month in progress up to the same day, for a fair
  // "vs forecast" on a part month.
  let fcToDate = null, curYm = null;
  if (maxDate && String(maxDate).startsWith(`${y}-`)) {
    curYm = String(maxDate).slice(0, 7);
    const from = Number(curYm.replace("-", "")) * 100 + 1, to = Number(String(maxDate).slice(0, 10).replace(/-/g, ""));
    const { rows } = await query(`SELECT COALESCE(SUM(s.net_sales),0) AS net ${FROM} WHERE ${FC} AND ${ECOM_SQL} AND s.date_key BETWEEN $1 AND $2`, [from, to]).catch(() => ({ rows: [] }));
    fcToDate = rows[0] ? n(rows[0].net) : null;
  }
  const a = new Map(act.rows.map((r) => [r.ym, totals(r)]));
  const p = new Map(prior.rows.map((r) => [`${y}-${r.ym.slice(5)}`, totals(r)]));
  const f = new Map(fc.rows.map((r) => [r.ym, n(r.net)]));
  return monthsOfYear(y).map((ym) => ({
    ym, actual: a.get(ym) || null, py: p.get(ym) || null, forecast: f.get(ym) ?? null,
    // What the actual is compared with: the whole month, or to date for the month in progress.
    forecastCompare: ym === curYm ? fcToDate : (f.get(ym) ?? null), partial: ym === curYm,
  }));
}

/*
 * Day by day for a window, with the same day last year (−365) beside it.
 *   → [{ date, dow, cy: totals, py: totals | null }]
 */
export async function getEcomDaily(win) {
  const [cy, py] = await Promise.all([
    query(`SELECT d.calendar_date AS dt, ${MEASURES} ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
            WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [win.from, win.to]),
    query(`SELECT d.calendar_date AS dt, ${MEASURES} ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
            WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2 GROUP BY 1`, [win.pyFrom, win.pyTo]),
  ]).catch(() => [{ rows: [] }, { rows: [] }]);
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const plus365 = (d) => new Date(new Date(d + "T00:00:00Z").getTime() + 365 * 86400000).toISOString().slice(0, 10);
  const prior = new Map(py.rows.map((r) => [plus365(iso(r.dt)), totals(r)]));
  return cy.rows.map((r) => {
    const date = iso(r.dt);
    return { date, dow: new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), cy: totals(r), py: prior.get(date) || null };
  });
}

export { monthWindow };

// Months with E-COM actuals, newest first ('YYYY-MM').
export async function listEcomMonths() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT to_char(d.calendar_date,'YYYY-MM') AS ym ${FROM} JOIN core.dim_date d ON d.date_key = s.date_key
        WHERE ${ACTUAL} AND ${ECOM_SQL} AND s.is_valid_day ORDER BY ym DESC`);
    return rows.map((r) => r.ym);
  } catch { return []; }
}

/*
 * The E-Commerce entity's monthly P&L from the management accounts (Joiin),
 * shaped by ecomPnlMonth: sales, margin, fees, marketing, other costs and
 * contribution per month.
 *   → { loaded, months: [{ ym, ...ecomPnlMonth }], years: [YYYY] }
 */
export async function getEcomPnl(year) {
  try {
    const { rows } = await query(
      `SELECT section, account, ym, value FROM finance.joiin_pl_entity WHERE entity_id = $1 ORDER BY ym`, [ECOM_JOIIN_ENTITY_ID]);
    if (!rows.length) return { loaded: false, months: [], years: [] };
    const years = [...new Set(rows.map((r) => Number(r.ym.slice(0, 4))))].sort((a, b) => b - a);
    const y = Number(year) || years[0];
    const byYm = new Map();
    for (const r of rows) if (r.ym.startsWith(`${y}-`)) (byYm.get(r.ym) || byYm.set(r.ym, []).get(r.ym)).push(r);
    const months = [...byYm.keys()].sort().map((ym) => ({ ym, ...ecomPnlMonth(byYm.get(ym)) }));
    return { loaded: true, year: y, months, years };
  } catch { return { loaded: false, months: [], years: [] }; }
}
