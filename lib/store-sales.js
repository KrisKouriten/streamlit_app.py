import { query } from "./db";

/*
 * Data access for the Store Sales & KPI dashboards.
 *
 * Governed definitions (mirroring the finance Excel model):
 *  - Only rows with is_valid_day are counted (the model's own validity flag).
 *  - Only real stores are included (operator_name IS NOT NULL); demo rows are ignored.
 *  - "This week" is the latest complete Monday-Sunday week in the data.
 *  - Prior-year comparatives are the same calendar dates minus 365 days.
 *  - ATV = gross sales / net transactions; conversion = net transactions / footfall in.
 *  - LFL (like-for-like) stores: trading in both the current and prior-year windows,
 *    with at least 4 weeks' trading history before the window starts.
 *  - Established stores: traded the full 2025 year and still trading.
 */

const REAL = "st.operator_name IS NOT NULL AND st.ownership_type <> 'OTHER'";
const ACTUAL = "sc.scenario_type = 'ACTUAL'";
const FC = "sc.scenario_code = 'STORE-FC-2026'";

const dk = (d) => Number(d.toISOString().slice(0, 10).replace(/-/g, ""));
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export async function getWindows() {
  const { rows } = await query(
    `SELECT MAX(d.calendar_date) AS max_date
     FROM commercial.fact_store_sales s
     JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
     JOIN core.dim_store st ON st.store_id = s.store_id
     JOIN core.dim_date d ON d.date_key = s.date_key
     WHERE ${ACTUAL} AND ${REAL}`
  );
  const raw = rows[0].max_date;
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
       SELECT st.store_id, SUM(s.net_sales) AS net
       FROM commercial.fact_store_sales s
       JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
       JOIN core.dim_store st ON st.store_id = s.store_id
       WHERE ${FC} AND ${REAL} AND s.date_key BETWEEN $1 AND $2
       GROUP BY st.store_id)
     SELECT
       COALESCE(SUM(cy.net),0)                            AS net,
       COALESCE(SUM(cy.gm),0)                             AS gm,
       COALESCE(SUM(cy.net) FILTER (WHERE cy.ownership_type='COMPANY'),0)   AS net_company,
       COALESCE(SUM(cy.net) FILTER (WHERE cy.ownership_type<>'COMPANY'),0)  AS net_franchise,
       COALESCE(SUM(py.net) FILTER (WHERE cy.ownership_type='COMPANY'),0)   AS py_company,
       COALESCE(SUM(py.net) FILTER (WHERE cy.ownership_type<>'COMPANY'),0)  AS py_franchise,
       COALESCE(SUM(fcst.net),0)                          AS forecast,
       COALESCE(SUM(fcst.net) FILTER (WHERE cy.ownership_type='COMPANY'),0)  AS fc_company,
       COALESCE(SUM(fcst.net) FILTER (WHERE cy.ownership_type<>'COMPANY'),0) AS fc_franchise,
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
     LEFT JOIN py ON py.store_id = cy.store_id
     LEFT JOIN fc fcst ON fcst.store_id = cy.store_id`,
    params
  );
  return rows[0];
}

export async function getFyPlanTotal() {
  const { rows } = await query(
    `SELECT COALESCE(SUM(s.net_sales),0) AS fy_plan
     FROM commercial.fact_store_sales s
     JOIN core.dim_scenario sc ON sc.scenario_id = s.scenario_id
     JOIN core.dim_store st ON st.store_id = s.store_id
     WHERE ${FC} AND ${REAL}`
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
  return rows;
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
  const out = { cy: null, py: null, monthly: monthly.rows, profile: profile.rows[0] || null };
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
