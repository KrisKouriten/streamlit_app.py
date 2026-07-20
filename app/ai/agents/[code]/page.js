import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../../lib/auth";
import { getAgent } from "../../../../lib/agents";
import { SubNav, Panel, Table } from "../../../finance-os/ui";
import { RunAgentButton } from "../../agent-ui";
import { AI_NAV } from "../../nav";

export const dynamic = "force-dynamic";
const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function AgentProfile({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { code } = await params;
  const a = await getAgent(code);
  if (!a) notFound();
  const canRun = hasRole(session, "ADMIN", "FINANCE");

  const FIELDS = [
    ["Purpose", a.purpose], ["Owner", a.owner_name], ["Reviewer", a.reviewer_name],
    ["Runner type", a.runner_type], ["Risk rating", a.risk_rating],
    ["Inputs", a.inputs], ["Data sources", a.data_sources], ["Instructions", a.instructions],
    ["KPI definitions", a.kpi_definitions],
    ["Materiality", a.materiality_gbp != null ? `£${Number(a.materiality_gbp).toLocaleString("en-GB")}` : "all non-report outputs treated as material"],
    ["Outputs", a.outputs_description], ["Exclusions", a.exclusions],
    ["Approval requirements", a.approval_required ? "Material outputs require human review before publication" : "Auto-publish permitted (not recommended)"],
    ["Escalation rules", a.escalation_rules], ["Data permissions", a.data_permissions],
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/ai" style={{ textDecoration: "none", color: "var(--faint)" }}>AI Control Tower</Link> · Agent profile
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{a.agent_name}</span>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>v{a.current_version} · {a.is_active ? "active" : "inactive"}</span>
          <RunAgentButton agentCode={a.agent_code} canRun={canRun} />
        </div>
      </header>
      <SubNav items={AI_NAV} active="/ai" />

      <Panel title="Governed definition">
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 16px" }}>
          {FIELDS.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 14, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
              <div style={{ minWidth: 170, color: "var(--muted)", flex: "none" }}>{label}</div>
              <div style={{ lineHeight: 1.55 }}>{value}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`Run history (${a.runs.length})`}>
        <Table columns={[
          { label: "Run", render: (r) => <Link href={`/ai/runs/${r.run_id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>#{r.run_id}</Link> },
          { label: "Started", render: (r) => fmt(r.started_at) },
          { label: "Trigger", render: (r) => `${r.trigger_type} · ${r.triggered_by}` },
          { label: "Status", tone: (r) => (r.status === "FAILED" ? "red" : r.status === "SUCCESS" ? "green" : "muted"), render: (r) => r.status },
          { label: "Outputs", align: "right", render: (r) => r.outputs },
          { label: "Summary", render: (r) => r.summary || "—" },
        ]} rows={a.runs} empty="No runs yet." />
      </Panel>

      <Panel title="Version history" note="the registry definition is versioned; edits create new versions">
        <Table columns={[
          { label: "Version", render: (v) => `v${v.version_number}` },
          { label: "Created", render: (v) => fmt(v.created_at) },
          { label: "By", render: (v) => v.created_by || "—" },
        ]} rows={a.versions} />
      </Panel>
    </div>
  );
}
