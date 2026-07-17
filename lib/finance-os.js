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
