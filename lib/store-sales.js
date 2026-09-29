import { query } from "./db";

/*
 * Data access for the Store Sales & KPI dashboards.
 *
 * Governed definitions (mirroring the finance Excel model):
 *  - Only rows with is_valid_day are counted (the model's own validity flag).
 *  - Only real stores are included (operator_name IS NOT NULL); demo rows are ignored.
 *  - "This week" is the latest complete Monday-Sunday week in the data.
 *  - Prior-year comparatives are the same calendar dates minus 365 days.
 *  - ATV = net sales / net transactions; conversion = net transactions / footfall in.
 *  - LFL (like-for-like) stores: trading in both the current and prior-year windows,
 *    with at least 4 weeks' trading history before the window starts.
 *  - Established stores: traded the full 2025 year and still trading.
 */

const REAL = "st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER'";
const ACTUAL = "sc.scenario_type = 'ACTUAL'";
// The forecast the dashboards compare against: the LIVE version from Plan –
// Finance → Sales Forecast (a SALES-FC-<n> scenario marked APPROVED). Until a
// version has been made live, the original 2026 store forecast stands in, so
// nothing reads blank on the day this ships.
const FC = `sc.scenario_id = COALESCE(
  (SELECT scenario_id FROM core.dim_scenario
    WHERE scenario_code LIKE 'SALES-FC-%' AND status = 'APPROVED'
    ORDER BY approved_at DESC NULLS LAST, version_number DESC LIMIT 1),
  (SELECT scenario_id FROM core.dim_scenario WHERE scenario_code = 'STORE-FC-2026'))`;

const dk = (d) => Number(d.toISOString().slice(0, 10).replace(/-/g, ""));
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// Build a window object (the shape getStoreLeague / getStoreDetail expect) from a
// date range. PY comparatives are the same calendar dates minus 365 days.
function mkWindow(from, to, label) {
  return {
    label, from: dk(from), to: dk(to),
    pyFrom: dk(addDays(from, -365)), pyTo: dk(addDays(to, -365)),
    fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10),
    lflCutoff: addDays(from, -28).toISOString().slice(0, 10),
  };
}

// The distinct months present in the actual store-sales feed, newest first ('YYYY-MM').
export async function listSalesMonths() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT to_char(d.calendar_date, 'YYYY-MM') AS ym
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         JOIN core.dim_date d ON d.date_key = s.date_key
        WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day
        ORDER BY ym DESC`);
    return rows.map((r) => r.ym);
  } catch { return []; }
}

// A window for a single calendar month 'YYYY-MM', capped at the data's max date.
export function monthWindow(ym, maxDateIso) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || "");
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  const from = new Date(Date.UTC(y, mo - 1, 1));
  let to = new Date(Date.UTC(y, mo, 0)); // last day of the month
  if (maxDateIso) { const md = new Date(maxDateIso + "T00:00:00Z"); if (md < to) to = md; }
  const label = from.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return mkWindow(from, to, label);
}

export async function getWindows() {
  const { rows } = await query(
    `SELECT MAX(d.calendar_date) AS max_date
     FROM commercial.fact_store_sales s
     JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
     JOIN core.dim_store st ON st.store_id = s.store_id
     JOIN core.dim_date d ON d.date_key = s.date_key
     WHERE ${ACTUAL} AND ${REAL}`
  );
  const raw = rows[0]?.max_date;
  if (!raw) return null; // real store data not loaded yet
  const iso = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
  const maxDate = new Date(iso + "T00:00:00Z");
  // latest complete Mon-Sun week ending on or before maxDate
  const dow = (maxDate.getUTCDay() + 6) % 7; // 0=Mon
  const lastSunday = addDays(maxDate, -(dow + 1));
  const weekStart = addDays(lastSunday, -6);
  const monthStart = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(maxDate.getUTCFullYear(), 0, 1));
  const w = (from, to, label) => ({
    label, from: dk(from), to: dk(to),
    pyFrom: dk(addDays(from, -365)), pyTo: dk(addDays(to, -365)),
    fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10),
    lflCutoff: addDays(from, -28).toISOString().slice(0, 10),
  });
  return {
    maxDate: maxDate.toISOString().slice(0, 10),
    week: w(weekStart, lastSunday, "This week"),
    mtd: w(monthStart, maxDate, "Month to date"),
    ytd: w(yearStart, maxDate, "Year to date"),
  };
}

// Aggregate one window: totals, operator split, LFL KPI YoY, vs forecast.
export async function getPeriodSummary(win) {
  const params = [win.from, win.to, win.pyFrom, win.pyTo, win.lflCutoff];
  const { rows } = await query(
    `WITH cy AS (
       SELECT st.store_id, st.ownership_type, st.is_established,
              st.first_trading_date <= $5::date AS mature,
              SUM(s.net_sales) AS net, SUM(s.gross_sales) AS gross,
              SUM(s.gross_margin) AS gm, SUM(s.transactions) AS trans,
              SUM(s.footfall) AS footfall
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
       GROUP BY st.store_id, st.ownership_type, st.is_established, mature),
     py AS (
       SELECT st.store_id,
              SUM(s.net_sales) AS net, SUM(s.gross_sales) AS gross,
              SUM(s.transactions) AS trans, SUM(s.footfall) AS footfall
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day AND s.date_key BETWEEN $3 AND $4
       GROUP BY st.store_id),
     fc AS (
       SELECT st.store_id, st.ownership_type, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${FC} AND ${REAL} AND s.date_key BETWEEN $1 AND $2
       GROUP BY st.store_id, st.ownership_type)
     SELECT
       COALESCE(SUM(cy.net),0)                            AS net,
       COALESCE(SUM(cy.gm),0)                             AS gm,
       COALESCE(SUM(cy.net) FILTER (WHERE cy.ownership_type='COMPANY'),0)   AS net_company,
       COALESCE(SUM(cy.net) FILTER (WHERE cy.ownership_type<>'COMPANY'),0)  AS net_franchise,
       COALESCE(SUM(py.net) FILTER (WHERE cy.ownership_type='COMPANY'),0)   AS py_company,
       COALESCE(SUM(py.net) FILTER (WHERE cy.ownership_type<>'COMPANY'),0)  AS py_franchise,
       -- The forecast for EVERY store in the window, not only those that have
       -- traded: a forecast store not yet open (or trading under another name)
       -- is still sales the plan expected, and leaving it out flattered the
       -- "vs forecast" figure.
       (SELECT COALESCE(SUM(net),0) FROM fc)                                  AS forecast,
       (SELECT COALESCE(SUM(net),0) FROM fc WHERE ownership_type='COMPANY')   AS fc_company,
       (SELECT COALESCE(SUM(net),0) FROM fc WHERE ownership_type<>'COMPANY')  AS fc_franchise,
       -- like-for-like block (stores present both years, 4wk+ mature)
       COUNT(*) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature)        AS lfl_stores,
       COALESCE(SUM(cy.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_net,
       COALESCE(SUM(py.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_py_net,
       COALESCE(SUM(cy.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_gross,
       COALESCE(SUM(py.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_py_gross,
       COALESCE(SUM(cy.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_trans,
       COALESCE(SUM(py.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_py_trans,
       COALESCE(SUM(cy.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_footfall,
       COALESCE(SUM(py.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature),0) AS lfl_py_footfall,
       -- LFL split by operator side
       COALESCE(SUM(cy.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_net_co,
       COALESCE(SUM(py.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_py_net_co,
       COALESCE(SUM(cy.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_gross_co,
       COALESCE(SUM(py.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_py_gross_co,
       COALESCE(SUM(cy.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_trans_co,
       COALESCE(SUM(py.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_py_trans_co,
       COALESCE(SUM(cy.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_ff_co,
       COALESCE(SUM(py.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type='COMPANY'),0)  AS lfl_py_ff_co,
       COALESCE(SUM(cy.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_net_fr,
       COALESCE(SUM(py.net)      FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_py_net_fr,
       COALESCE(SUM(cy.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_gross_fr,
       COALESCE(SUM(py.gross)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_py_gross_fr,
       COALESCE(SUM(cy.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_trans_fr,
       COALESCE(SUM(py.trans)    FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_py_trans_fr,
       COALESCE(SUM(cy.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_ff_fr,
       COALESCE(SUM(py.footfall) FILTER (WHERE py.store_id IS NOT NULL AND cy.mature AND cy.ownership_type<>'COMPANY'),0) AS lfl_py_ff_fr,
       -- established set
       COUNT(*) FILTER (WHERE cy.is_established)                       AS est_stores,
       COALESCE(SUM(cy.net) FILTER (WHERE cy.is_established),0)        AS est_net,
       COALESCE(SUM(py.net) FILTER (WHERE cy.is_established),0)        AS est_py_net
     FROM cy
     LEFT JOIN py ON py.store_id = cy.store_id`,
    params
  );
  return rows[0];
}

// The full-year plan for `year` — the live forecast's sales for that calendar
// year. It used to add up the whole forecast, which was one year while the
// forecast only held 2026; with four years loaded it must follow the year being
// viewed (the dashboards pass their year-to-date window's year).
export async function getFyPlanTotal(year = new Date().getFullYear()) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(s.net_sales),0) AS fy_plan
     FROM commercial.fact_store_sales s
     JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
     JOIN core.dim_store st ON st.store_id = s.store_id
     WHERE ${FC} AND ${REAL} AND s.date_key BETWEEN $1 AND $2`,
    [Number(year) * 10000 + 101, Number(year) * 10000 + 1231]
  );
  return Number(rows[0].fy_plan);
}

export async function getMarketAssumptions() {
  const { rows } = await query(
    `SELECT metric_code, metric_name, value, period_label, source FROM core.market_assumption`
  );
  const out = {};
  for (const r of rows) out[r.metric_code] = { ...r, value: Number(r.value) };
  return out;
}

// League table: per-store KPIs for a window with prior-year comparatives.
export async function getStoreLeague(win) {
  const { rows } = await query(
    `WITH cy AS (
       SELECT st.store_id, st.store_code, st.store_name, st.operator_name, st.ownership_type,
              SUM(s.net_sales) AS net, SUM(s.gross_sales) AS gross, SUM(s.gross_margin) AS gm,
              SUM(s.transactions) AS trans, SUM(s.footfall) AS footfall
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
       GROUP BY st.store_id, st.store_code, st.store_name, st.operator_name, st.ownership_type),
     py AS (
       SELECT st.store_id, SUM(s.net_sales) AS net, SUM(s.gross_sales) AS gross,
              SUM(s.transactions) AS trans, SUM(s.footfall) AS footfall
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day AND s.date_key BETWEEN $3 AND $4
       GROUP BY st.store_id)
     SELECT cy.*, py.net AS py_net, py.gross AS py_gross, py.trans AS py_trans, py.footfall AS py_footfall
     FROM cy LEFT JOIN py ON py.store_id = cy.store_id
     ORDER BY cy.net DESC`,
    [win.from, win.to, win.pyFrom, win.pyTo]
  );
  const fc = await storeForecastIn(win);
  for (const r of rows) r.fc_net = fc.get(Number(r.store_id))?.net ?? null;
  return rows;
}

// The live forecast per store for a window: Map(store_id → { store_code,
// store_name, operator_name, ownership_type, net }).
async function storeForecastIn(win) {
  const { rows } = await query(
    `SELECT st.store_id, st.store_code, st.store_name, st.operator_name, st.ownership_type, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
      WHERE ${FC} AND ${REAL} AND s.date_key BETWEEN $1 AND $2
      GROUP BY st.store_id, st.store_code, st.store_name, st.operator_name, st.ownership_type`,
    [win.from, win.to]);
  return new Map(rows.map((r) => [Number(r.store_id), { ...r, net: Number(r.net) || 0 }]));
}

/*
 * Stores the live forecast expects sales from in a window that have traded
 * nothing in it: a store not open yet, or one whose name in the forecast does
 * not match the store it trades as (so its actuals sit on another row). Either
 * way the dashboards count the forecast and no sales against it, so it is
 * named rather than left to explain a variance.
 */
export async function getForecastOnlyStores(win) {
  const [fc, { rows: traded }] = await Promise.all([
    storeForecastIn(win),
    query(
      `SELECT DISTINCT s.store_id
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
        WHERE ${ACTUAL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2`, [win.from, win.to]),
  ]);
  const has = new Set(traded.map((r) => Number(r.store_id)));
  return [...fc.values()].filter((r) => !has.has(Number(r.store_id)) && r.net).sort((a, b) => b.net - a.net);
}

/*
 * Actual against the live forecast by month for a calendar year, company and
 * franchise. Actual months run to the latest trading day; forecast covers the
 * whole year, so later months show forecast only.
 *   → [{ ym, actual: {company, franchise, total}, forecast: {company, franchise, total} }]
 */
export async function getMonthlyVsForecast(year = new Date().getFullYear()) {
  const from = Number(year) * 10000 + 101, to = Number(year) * 10000 + 1231;
  const side = `CASE WHEN st.ownership_type = 'COMPANY' THEN 'company' ELSE 'franchise' END`;
  const [act, fc] = await Promise.all([
    query(
      `SELECT to_char(d.calendar_date,'YYYY-MM') AS ym, ${side} AS side, SUM(s.net_sales) AS net
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         JOIN core.dim_date d ON d.date_key = s.date_key
        WHERE ${ACTUAL} AND ${REAL} AND s.is_valid_day AND s.date_key BETWEEN $1 AND $2
        GROUP BY 1, 2`, [from, to]),
    query(
      `SELECT to_char(d.calendar_date,'YYYY-MM') AS ym, ${side} AS side, SUM(s.net_sales) AS net
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         JOIN core.dim_date d ON d.date_key = s.date_key
        WHERE ${FC} AND ${REAL} AND s.date_key BETWEEN $1 AND $2
        GROUP BY 1, 2`, [from, to]),
  ]);
  const months = new Map();
  const cell = (ym) => months.get(ym) || months.set(ym, {
    ym, actual: { company: 0, franchise: 0, total: 0 }, forecast: { company: 0, franchise: 0, total: 0 }, hasActual: false,
  }).get(ym);
  for (const r of act.rows) { const m = cell(r.ym); const v = Number(r.net) || 0; m.actual[r.side] += v; m.actual.total += v; m.hasActual = true; }
  for (const r of fc.rows) { const m = cell(r.ym); const v = Number(r.net) || 0; m.forecast[r.side] += v; m.forecast.total += v; }
  return [...months.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

export async function getStoreList() {
  const { rows } = await query(
    `SELECT store_code, store_name, operator_name, ownership_type, first_trading_date, last_trading_date, is_established
     FROM core.dim_store WHERE operator_name IS NOT NULL AND ownership_type <> 'OTHER' ORDER BY store_name`
  );
  return rows;
}

// Single-store detail: window totals CY vs PY plus monthly trend and forecast.
export async function getStoreDetail(storeCode, win) {
  const [totals, monthly, profile] = await Promise.all([
    query(
      `WITH agg AS (
         SELECT CASE WHEN s.date_key BETWEEN $2 AND $3 THEN 'cy' ELSE 'py' END AS era,
                SUM(s.net_sales) AS net, SUM(s.gross_sales) AS gross, SUM(s.gross_margin) AS gm,
                SUM(s.units_sold) AS units, SUM(s.transactions) AS trans,
                SUM(s.transactions_gross) AS trans_gross, SUM(s.return_transactions) AS ret_trans,
                SUM(s.footfall) AS footfall, SUM(s.return_value) AS returns
         FROM commercial.fact_store_sales s
         JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
         JOIN core.dim_store st ON st.store_id = s.store_id
         WHERE ${ACTUAL} AND st.store_code = $1 AND s.is_valid_day
           AND (s.date_key BETWEEN $2 AND $3 OR s.date_key BETWEEN $4 AND $5)
         GROUP BY era)
       SELECT * FROM agg`,
      [storeCode, win.from, win.to, win.pyFrom, win.pyTo]
    ),
    query(
      `SELECT d.calendar_year AS yr, d.month_number AS mn, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       JOIN core.dim_date d ON d.date_key = s.date_key
       WHERE ${ACTUAL} AND st.store_code = $1 AND s.is_valid_day
       GROUP BY d.calendar_year, d.month_number ORDER BY yr, mn`,
      [storeCode]
    ),
    query(
      `SELECT p.*, st.store_name FROM commercial.store_cost_profile p
       JOIN core.dim_store st ON st.store_id = p.store_id WHERE st.store_code = $1`,
      [storeCode]
    ),
  ]);
  // The live forecast for the same store, by month, and for the window.
  const [fcMonthly, fcWin] = await Promise.all([
    query(
      `SELECT d.calendar_year AS yr, d.month_number AS mn, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       JOIN core.dim_date d ON d.date_key = s.date_key
       WHERE ${FC} AND st.store_code = $1
       GROUP BY d.calendar_year, d.month_number ORDER BY yr, mn`, [storeCode]).catch(() => ({ rows: [] })),
    query(
      `SELECT COALESCE(SUM(s.net_sales),0) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${FC} AND st.store_code = $1 AND s.date_key BETWEEN $2 AND $3`, [storeCode, win.from, win.to]).catch(() => ({ rows: [{ net: 0 }] })),
  ]);
  const out = { cy: null, py: null, monthly: monthly.rows, fcMonthly: fcMonthly.rows, fcWindow: Number(fcWin.rows[0]?.net) || 0, profile: profile.rows[0] || null };
  for (const r of totals.rows) out[r.era] = r;
  return out;
}

// Break-even board.
export async function getBreakEven() {
  const { rows } = await query(
    `SELECT st.store_code, st.store_name, st.operator_name, p.*
     FROM commercial.store_cost_profile p
     JOIN core.dim_store st ON st.store_id = p.store_id
     ORDER BY (p.ytd_actual - p.ytd_break_even) DESC NULLS LAST`
  );
  return rows;
}
