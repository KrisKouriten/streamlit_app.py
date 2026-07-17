import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getExecutiveKpis, getInsights, getLatestReportDate, formatKpi } from "../../../lib/finance-os";

export const dynamic = "force-dynamic";

const RAG = {
  GREEN: { fg: "var(--green)", bg: "var(--green-bg)", label: "On track" },
  AMBER: { fg: "var(--amber)", bg: "var(--amber-bg)", label: "Watch" },
  RED: { fg: "#a32d2d", bg: "#f7e6e3", label: "Action" },
  INFO: { fg: "var(--muted)", bg: "var(--line)", label: "Info" },
};

const SEV = {
  CRITICAL: "#a32d2d", HIGH: "#a32d2d", MEDIUM: "var(--amber)", LOW: "var(--muted)",
};

function fmtGbp(n) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1000).toLocaleString("en-GB")}k`;
  return `${sign}£${Math.round(abs).toLocaleString("en-GB")}`;
}

export default async function ExecutiveHub() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [kpis, insights, reportDate] = await Promise.all([
    getExecutiveKpis(),
    getInsights(),
    getLatestReportDate(),
  ]);

  const counts = { GREEN: 0, AMBER: 0, RED: 0, INFO: 0 };
  for (const k of kpis) counts[k.status || "INFO"]++;
  const dateLabel = reportDate
    ? new Date(reportDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "—";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
            <Link href="/finance-os" style={{ textDecoration: "none", color: "var(--faint)" }}>Finance OS</Link> · Executive intelligence
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Executive Intelligence Hub</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>As at {dateLabel}</div>
      </header>

      {/* RAG summary */}
      <div style={{ display: "flex", gap: 10, marginBottom: 26, flexWrap: "wrap" }}>
        {[["GREEN", "On track"], ["AMBER", "Watch"], ["RED", "Action needed"]].map(([s, lbl]) => (
          <div key={s} style={{ flex: "1 1 160px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: RAG[s].fg }} />
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{lbl}</span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 600, marginTop: 6, lineHeight: 1 }}>{counts[s]}</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>KPIs</div>
          </div>
        ))}
      </div>

      {/* KPI grid */}
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Key metrics</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginBottom: 30 }}>
        {kpis.map((k) => {
          const rag = RAG[k.status || "INFO"];
          const arrow = k.trend === "UP" ? "▲" : k.trend === "DOWN" ? "▼" : "▬";
          return (
            <div key={k.kpi_code} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{k.kpi_name}</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: rag.fg, background: rag.bg, padding: "2px 7px", borderRadius: 6 }}>{rag.label}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{formatKpi(k.actual_value, k.unit_of_measure)}</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>
                Target {formatKpi(k.target_value, k.unit_of_measure)} · <span style={{ color: rag.fg }}>{arrow}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI insights */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>AI insights</div>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· awaiting human review</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {insights.length === 0 && (
          <div style={{ fontSize: 13.5, color: "var(--faint)", padding: "12px 0" }}>No insights to review.</div>
        )}
        {insights.map((i) => (
          <div key={i.insight_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: SEV[i.severity] || "var(--muted)" }}>
                  {i.insight_type}
                </span>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{i.headline}</span>
              </div>
              {i.financial_impact != null && (
                <span style={{ fontSize: 13, fontWeight: 600, color: Number(i.financial_impact) < 0 ? "#a32d2d" : "var(--green)", flex: "none" }}>
                  {fmtGbp(i.financial_impact)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: 8 }}>{i.narrative}</div>
            {i.recommended_action && (
              <div style={{ fontSize: 13, color: "var(--ink)", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                <span style={{ color: "var(--faint)" }}>Recommended: </span>{i.recommended_action}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: "var(--faint)", display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>{i.digital_colleague}</span>
              <span>Confidence {i.confidence_pct != null ? `${Math.round(Number(i.confidence_pct) * 100)}%` : "—"}</span>
              <span>Status: {i.human_review_status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
