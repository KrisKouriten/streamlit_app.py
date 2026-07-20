import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../../lib/auth";
import { getAction } from "../../../../lib/actions";
import { SubNav, Panel, money, dateLabel } from "../../../finance-os/ui";
import { GOVERN_NAV } from "../nav";
import { ActionStatusChip, SOURCE_LABEL, ActionControls, RealisedValueForm } from "../action-ui";

export const dynamic = "force-dynamic";
const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function ActionDetail({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const a = await getAction(Number(id));
  if (!a) notFound();
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const canClose = hasRole(session, "ADMIN", "FINANCE", "EXEC");
  const isOwner = (a.owner_name || "").toLowerCase() === (session.name || "").toLowerCase();

  const FIELDS = [
    ["Source", SOURCE_LABEL[a.source_type] || a.source_type], ["Owner", a.owner_name], ["Sponsor", a.sponsor || "—"],
    ["Due", dateLabel(a.due_date)], ["Progress", `${a.progress_pct ?? 0}%`],
    ["Expected value", a.expected_value_gbp != null ? money(a.expected_value_gbp) : "—"],
    ["Realised value", a.realised_value_gbp != null ? money(a.realised_value_gbp) : "—"],
    ["Linked KPI", a.kpi_name || "—"], ["Linked dashboard", a.dashboard_code || "—"],
    ["Linked agent run", a.agent_run_id ? `#${a.agent_run_id}` : "—"],
    ["Closure approved", a.closure_approved_by ? `${a.closure_approved_by} · ${fmt(a.closure_approved_at)}` : "—"],
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/govern/actions" style={{ textDecoration: "none", color: "var(--faint)" }}>Govern · Action Centre</Link> · Action #{a.action_id}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{a.action_title}</span>
          <ActionStatusChip status={a.status} />
        </div>
      </header>
      <SubNav items={GOVERN_NAV} active="/govern/actions" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
        {FIELDS.map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 13px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {a.action_description && <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 10 }}>{a.action_description}</p>}
      {a.root_cause && <div style={{ fontSize: 13.5, marginBottom: 14 }}><span style={{ color: "var(--faint)" }}>Root cause: </span>{a.root_cause}</div>}
      {a.insight_id && <div style={{ fontSize: 13, marginBottom: 14 }}>Originated from AI insight #{a.insight_id}{a.agent_run_id ? <> · <Link href={`/ai/runs/${a.agent_run_id}`}>view agent run</Link></> : null}</div>}

      <Panel title="Manage">
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
          <ActionControls action={{ action_id: a.action_id, status: a.status, owner_name: a.owner_name }} isManager={isManager} canClose={canClose} isOwner={isOwner} />
          {["COMPLETE", "CLOSED"].includes(a.status) && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>Realised value (feeds the benefits tracker)</div>
              <RealisedValueForm actionId={a.action_id} current={a.realised_value_gbp} />
            </div>
          )}
        </div>
      </Panel>

      {a.evidence.length > 0 && (
        <Panel title={`Evidence (${a.evidence.length})`}>
          {a.evidence.map((e) => (
            <div key={e.evidence_id} style={{ fontSize: 13, padding: "6px 0" }}>
              {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.label} ↗</a> : <strong>{e.label}</strong>}
              {e.note ? <span style={{ color: "var(--muted)" }}> — {e.note}</span> : null}
              <span style={{ color: "var(--faint)" }}> · {e.added_by}</span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Activity">
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 14px" }}>
          {a.updates.map((u) => (
            <div key={u.update_id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <span style={{ color: "var(--faint)", minWidth: 110, flex: "none" }}>{fmt(u.created_at)}</span>
              <span style={{ flex: 1 }}>
                {u.from_status || u.to_status ? <strong>{u.from_status ? `${u.from_status} → ${u.to_status}` : u.to_status}{u.progress_pct != null ? ` · ${u.progress_pct}%` : ""}. </strong> : (u.progress_pct != null ? <strong>{u.progress_pct}%. </strong> : null)}
                {u.body}
              </span>
              <span style={{ color: "var(--faint)" }}>{u.author}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
