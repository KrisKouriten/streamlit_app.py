import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../lib/auth";
import { listAgents, getReviewQueue, getRecentExceptions } from "../../lib/agents";
import { SubNav, Panel, Table } from "../finance-os/ui";
import { RunAgentButton } from "./agent-ui";
import { AI_NAV } from "./nav";

export const dynamic = "force-dynamic";

const RISK = { LOW: "var(--green)", MEDIUM: "var(--amber)", HIGH: "var(--red)" };
const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

export default async function AgentCentre() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canRun = hasRole(session, "ADMIN", "FINANCE");
  const [agents, queue, exceptions] = await Promise.all([listAgents(), getReviewQueue(), getRecentExceptions(5)]);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>AI Control Tower</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Finance Agent Control Centre</div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, maxWidth: 660 }}>
          Every agent is a governed, versioned configuration with a named owner and reviewer. Every run is recorded permanently;
          material outputs require a human decision before they count. Agents cannot post journals, release payments, change
          approved forecasts or communicate externally — those capabilities do not exist in the runner.
        </p>
      </header>
      <SubNav items={AI_NAV} active="/ai" />

      {queue.length > 0 && (
        <Link href="/ai/review" style={{ textDecoration: "none" }}>
          <div style={{ background: "var(--amber-bg)", border: "1px solid var(--amber)", borderRadius: "var(--radius)", padding: "12px 16px", marginBottom: 18, fontSize: 13.5, color: "var(--ink)" }}>
            <strong>{queue.length} output{queue.length === 1 ? "" : "s"}</strong> awaiting human review → open the review queue
          </div>
        </Link>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12, marginBottom: 26 }}>
        {agents.map((a) => (
          <div key={a.agent_code} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <Link href={`/ai/agents/${a.agent_code}`} style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>{a.agent_name}</Link>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: RISK[a.risk_rating] }}>{a.risk_rating} RISK</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>{a.purpose}</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 10 }}>
              Owner {a.owner_name} · Reviewer {a.reviewer_name} · v{a.current_version} · {a.runner_type}
              <br />Last run: {fmt(a.last_run_at)} {a.last_status ? `(${a.last_status})` : ""}
              {Number(a.pending_reviews) > 0 && <span style={{ color: "var(--amber)" }}> · {a.pending_reviews} pending review</span>}
            </div>
            <RunAgentButton agentCode={a.agent_code} canRun={canRun} />
          </div>
        ))}
      </div>

      <Panel title="Agent performance" note="cumulative since first run">
        <Table columns={[
          { label: "Agent", render: (a) => <Link href={`/ai/agents/${a.agent_code}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{a.agent_name}</Link> },
          { label: "Runs", align: "right", render: (a) => a.total_runs ?? 0 },
          { label: "Failed", align: "right", tone: (a) => (Number(a.failed_runs) ? "red" : "muted"), render: (a) => a.failed_runs ?? 0 },
          { label: "Outputs", align: "right", render: (a) => a.total_outputs ?? 0 },
          { label: "Approved", align: "right", render: (a) => a.approved_outputs ?? 0 },
          { label: "Rejected", align: "right", render: (a) => a.rejected_outputs ?? 0 },
          { label: "Approval rate", align: "right", render: (a) => {
            const d = Number(a.approved_outputs) + Number(a.rejected_outputs);
            return d ? `${Math.round((Number(a.approved_outputs) / d) * 100)}%` : "—";
          } },
        ]} rows={agents} />
      </Panel>

      <Panel title="Open exceptions" note="unresolved run failures and agent-raised alerts">
        {exceptions.length === 0
          ? <div style={{ fontSize: 13.5, color: "var(--faint)" }}>No open exceptions.</div>
          : exceptions.map((e) => (
            <div key={e.exception_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 6, fontSize: 13 }}>
              <strong style={{ color: "var(--red)" }}>{e.severity}</strong> · {e.agent_code} · {e.message}
              <Link href={`/ai/runs/${e.run_id}`} style={{ marginLeft: 8 }}>view run</Link>
            </div>
          ))}
      </Panel>
    </div>
  );
}
