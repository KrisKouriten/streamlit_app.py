import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../../lib/auth";
import { getRun } from "../../../../lib/agents";
import { SubNav, Panel, money } from "../../../finance-os/ui";
import { LifecycleChip, OutputReviewPanel } from "../../agent-ui";
import { AI_NAV } from "../../nav";

export const dynamic = "force-dynamic";
const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const SEV = { CRITICAL: "var(--red)", HIGH: "var(--red)", MEDIUM: "var(--amber)", LOW: "var(--muted)" };

export default async function RunDetail({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const run = await getRun(Number(id));
  if (!run) notFound();
  const canReview = hasRole(session, "ADMIN", "FINANCE");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/ai" style={{ textDecoration: "none", color: "var(--faint)" }}>AI Control Tower</Link> ·{" "}
          <Link href={`/ai/agents/${run.agent_code}`} style={{ textDecoration: "none", color: "var(--faint)" }}>{run.agent_name}</Link> · Run #{run.run_id}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
          Agent run #{run.run_id}
          <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 10, color: run.status === "FAILED" ? "var(--red)" : run.status === "SUCCESS" ? "var(--green)" : "var(--muted)" }}>{run.status}</span>
        </div>
      </header>
      <SubNav items={AI_NAV} active="/ai" />

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 16px", fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
        <div><span style={{ color: "var(--muted)" }}>Started:</span> {fmt(run.started_at)} · <span style={{ color: "var(--muted)" }}>Finished:</span> {fmt(run.finished_at)} · <span style={{ color: "var(--muted)" }}>Trigger:</span> {run.trigger_type} by {run.triggered_by}</div>
        {run.period_start && <div><span style={{ color: "var(--muted)" }}>Reporting period:</span> {String(run.period_start).slice(0, 10)} → {String(run.period_end).slice(0, 10)}</div>}
        <div><span style={{ color: "var(--muted)" }}>Data freshness:</span> {run.data_freshness}</div>
        {run.plan && <div><span style={{ color: "var(--muted)" }}>Plan:</span> {run.plan}</div>}
        {run.summary && <div><span style={{ color: "var(--muted)" }}>Summary:</span> {run.summary}</div>}
        {run.confidence_pct != null && <div><span style={{ color: "var(--muted)" }}>Confidence:</span> {Math.round(run.confidence_pct * 100)}%</div>}
      </div>

      <Panel title="Steps performed">
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 16px" }}>
          {run.steps.map((s) => (
            <div key={s.step_id} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <span style={{ color: "var(--faint)", flex: "none" }}>{s.step_no}.</span>
              <span style={{ flex: 1 }}>{s.title}{s.detail ? ` — ${s.detail}` : ""}</span>
              <span style={{ color: s.status === "FAILED" ? "var(--red)" : "var(--green)", fontWeight: 600, fontSize: 11.5 }}>{s.status}</span>
            </div>
          ))}
        </div>
      </Panel>

      {run.exceptions.length > 0 && (
        <Panel title="Exceptions">
          {run.exceptions.map((e) => (
            <div key={e.exception_id} style={{ background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 6, fontSize: 13 }}>
              <strong>{e.severity}</strong> · {e.message}
            </div>
          ))}
        </Panel>
      )}

      <Panel title={`Outputs (${run.outputs.length})`} note="material outputs require a review decision before they count anywhere">
        {run.outputs.length === 0 && <div style={{ fontSize: 13.5, color: "var(--faint)" }}>This run produced no outputs.</div>}
        {run.outputs.map((o) => (
          <div key={o.output_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: SEV[o.severity] || "var(--muted)" }}>{o.output_type}{o.severity ? ` · ${o.severity}` : ""}</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{o.headline}</span>
              {o.financial_impact != null && (
                <span style={{ fontSize: 13, fontWeight: 600, color: Number(o.financial_impact) < 0 ? "var(--red)" : "var(--green)" }}>{money(o.financial_impact, { compact: true })}</span>
              )}
              <LifecycleChip lifecycle={o.lifecycle} />
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: 6 }}>{o.body}</div>
            {o.recommended_action && (
              <div style={{ fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                <span style={{ color: "var(--faint)" }}>Recommended: </span>{o.recommended_action}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: "var(--faint)" }}>
              {o.store_name ? `${o.store_name} · ` : ""}validation: {o.validation_result}
              {o.is_material ? " · MATERIAL" : ""} · confidence {o.confidence_pct != null ? `${Math.round(o.confidence_pct * 100)}%` : "—"}
              {o.insight_id ? ` · insight #${o.insight_id}` : ""}{o.action_id ? ` · action #${o.action_id}` : ""}
            </div>
            {o.reviews && o.reviews.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                {o.reviews.map((r, i) => <div key={i}>{r.decision} by {r.reviewer}{r.comment ? ` — "${r.comment}"` : ""}</div>)}
              </div>
            )}
            <OutputReviewPanel output={o} canReview={canReview} />
          </div>
        ))}
      </Panel>
    </div>
  );
}
