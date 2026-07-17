import { query } from "./db";

// Read helpers for the Finance Operating System dashboards. Each returns plain
// data so pages can render on the server, exactly like the month-end tracker.

export async function getDashboards() {
  const { rows } = await query(
    `SELECT dashboard_code, dashboard_name, dashboard_layer, purpose,
            primary_audience, finance_owner, digital_colleague, refresh_frequency
     FROM intelligence.dashboard_registry
     WHERE is_active = true
     ORDER BY display_order`
  );
  return rows;
}

// Latest KPI reading per KPI (most recent date), with its catalogue metadata.
export async function getExecutiveKpis() {
  const { rows } = await query(
    `SELECT DISTINCT ON (k.kpi_id)
        k.kpi_code, k.kpi_name, k.dashboard_domain, k.unit_of_measure,
        k.favourable_direction,
        r.actual_value, r.target_value, r.variance_value, r.variance_pct,
        r.status, r.trend, d.calendar_date
     FROM intelligence.fact_kpi_result r
     JOIN intelligence.dim_kpi k ON k.kpi_id = r.kpi_id
     JOIN core.dim_date d ON d.date_key = r.date_key
     ORDER BY k.kpi_id, d.calendar_date DESC`
  );
  return rows;
}

// AI insights awaiting or cleared by human review (governance requirement:
// nothing is auto-actioned — a person signs off).
export async function getInsights() {
  const { rows } = await query(
    `SELECT insight_id, dashboard_code, insight_type, severity, headline,
            narrative, recommended_action, financial_impact, confidence_pct,
            digital_colleague, human_review_status, generated_at
     FROM intelligence.ai_insight
     WHERE human_review_status IN ('PENDING','APPROVED','AMENDED')
     ORDER BY
       CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
       generated_at DESC`
  );
  return rows;
}

export async function getLatestReportDate() {
  const { rows } = await query(
    `SELECT MAX(calendar_date) AS report_date FROM core.dim_date WHERE calendar_date <= CURRENT_DATE`
  );
  return rows[0]?.report_date || null;
}

// --- Budget & Forecast: full-year P&L by account, current fiscal year -----
export async function getBudgetForecastPL() {
  const { rows } = await query(
    `SELECT a.account_name, a.account_group, a.sort_order,
            COALESCE(SUM(v.amount_gbp) FILTER (WHERE v.scenario_type='ACTUAL'),0)   AS actual,
            COALESCE(SUM(v.amount_gbp) FILTER (WHERE v.scenario_type='BUDGET'),0)   AS budget,
            COALESCE(SUM(v.amount_gbp) FILTER (WHERE v.scenario_type='FORECAST'),0) AS forecast
     FROM intelligence.vw_actual_budget_forecast v
     JOIN core.dim_account a ON a.account_code = v.account_code
     WHERE v.fiscal_year = (SELECT MAX(fiscal_year) FROM intelligence.vw_actual_budget_forecast)
     GROUP BY a.account_name, a.account_group, a.sort_order
     ORDER BY a.sort_order`
  );
  return rows;
}

// --- Management Accounts: variance for the latest actual period -----------
export async function getManagementVariance() {
  const { rows } = await query(
    `SELECT a.account_name, a.sort_order, a.natural_sign,
            mv.actual_amount, mv.budget_amount, mv.forecast_amount,
            mv.actual_vs_budget, mv.actual_vs_budget_pct
     FROM intelligence.vw_management_accounts_variance mv
     JOIN core.dim_account a ON a.account_id = mv.account_id
     WHERE mv.date_key = (
       SELECT MAX(date_key) FROM intelligence.vw_management_accounts_variance
       WHERE actual_amount IS NOT NULL)
     ORDER BY a.sort_order`
  );
  return rows;
}

// --- Store Sales & KPI: latest actual month, per store -------------------
export async function getStorePerformance() {
  const { rows } = await query(
    `SELECT store_code, store_name, region, ownership_type,
            net_sales, gross_margin, ebitda, labour_cost,
            sales_per_sqft, sales_per_labour_hr, forecast_accuracy
     FROM intelligence.vw_store_performance
     WHERE scenario_type = 'ACTUAL'
       AND calendar_date = (SELECT MAX(calendar_date) FROM intelligence.vw_store_performance)
     ORDER BY net_sales DESC`
  );
  return rows;
}

// --- Franchise: latest period, per franchise store -----------------------
export async function getFranchise() {
  const { rows } = await query(
    `SELECT s.store_name, s.region, f.invoiced_sales, f.cash_received,
            f.closing_receivable, f.overdue_receivable, f.royalty_income,
            f.franchise_ebitda, f.credit_limit
     FROM commercial.fact_franchise f
     JOIN core.dim_store s ON s.store_id = f.store_id
     WHERE f.date_key = (SELECT MAX(date_key) FROM commercial.fact_franchise)
     ORDER BY f.invoiced_sales DESC`
  );
  return rows;
}

// --- Fixed Assets: latest month, per asset -------------------------------
export async function getFixedAssets() {
  const { rows } = await query(
    `SELECT fa.asset_description, fa.asset_category, fa.original_cost,
            m.opening_nbv, m.depreciation, m.closing_nbv, m.roi_pct, m.payback_months
     FROM finance.fact_fixed_asset_monthly m
     JOIN finance.dim_fixed_asset fa ON fa.asset_id = m.asset_id
     WHERE m.date_key = (SELECT MAX(date_key) FROM finance.fact_fixed_asset_monthly)
     ORDER BY fa.original_cost DESC`
  );
  return rows;
}

// --- Inventory: latest snapshot, aggregated by category ------------------
export async function getInventoryHealth() {
  const { rows } = await query(
    `SELECT category,
            SUM(stock_value) AS stock_value,
            SUM(value_in_transit) AS value_in_transit,
            SUM(stock_over_90_days) AS over_90,
            SUM(stock_over_180_days) AS over_180,
            AVG(avg_weeks_cover) AS weeks_cover,
            AVG(avg_availability_pct) AS availability,
            AVG(avg_sell_through_pct) AS sell_through
     FROM intelligence.vw_inventory_health
     WHERE calendar_date = (SELECT MAX(calendar_date) FROM intelligence.vw_inventory_health)
     GROUP BY category
     ORDER BY stock_value DESC`
  );
  return rows;
}

// --- Cash Flow & Treasury: latest position + flow categories -------------
export async function getCashPosition() {
  const { rows } = await query(
    `SELECT entity_name, available_cash, facility_limit, facility_used,
            total_headroom, all_accounts_reconciled
     FROM intelligence.vw_cash_headroom
     WHERE calendar_date = (SELECT MAX(calendar_date) FROM intelligence.vw_cash_headroom)`
  );
  return rows;
}

export async function getCashFlows() {
  const { rows } = await query(
    `SELECT cashflow_category, cashflow_subcategory, amount_gbp, committed_flag
     FROM finance.fact_cashflow
     WHERE date_key = (SELECT MAX(date_key) FROM finance.fact_cashflow)
     ORDER BY amount_gbp DESC`
  );
  return rows;
}

// Format a KPI value for display according to its unit of measure.
export function formatKpi(value, unit) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (unit === "PERCENT") return `${(n * 100).toFixed(1)}%`;
  if (unit === "GBP") {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
    if (abs >= 1_000) return `£${Math.round(n / 1000).toLocaleString("en-GB")}k`;
    return `£${Math.round(n).toLocaleString("en-GB")}`;
  }
  return n.toLocaleString("en-GB");
}
