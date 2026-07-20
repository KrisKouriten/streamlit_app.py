import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { listActions, getActionSummary, markOverdueActions } from "../../../lib/actions";
import { SubNav, Panel, Table, money, dateLabel } from "../../finance-os/ui";
import { GOVERN_NAV } from "./nav";
import { ActionStatusChip, SOURCE_LABEL, CreateActionForm } from "./action-ui";

export const dynamic = "force-dynamic";

export default async function ActionCentre({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  await markOverdueActions();
  const [actions, summary] = await Promise.all([
    listActions({ status: params?.status || null, source: params?.source || null }),
    getActionSummary(),
  ]);

  const filters = [["", "All"], ["OPEN", "Open"], ["IN_PROGRESS", "In progress"], ["OVERDUE", "Overdue"], ["COMPLETE", "Awaiting closure"], ["CLOSED", "Closed"]];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Govern</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Action Centre</div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 6, maxWidth: 640 }}>
          One register for every action — from dashboards, month-end, the weekly schedule, AI agents, the board, controls and audit.
          Completion and closure approval are separate events.
        </p>
      </header>
      <SubNav items={GOVERN_NAV} active="/govern/actions" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 18 }}>
        {[["Open actions", summary.open], ["Overdue", summary.overdue], ["Awaiting closure", summary.awaiting_closure], ["Open value", money(summary.open_value, { compact: true })]].map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: l === "Overdue" && v > 0 ? "#a32d2d" : "var(--ink)" }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {filters.map(([id, lbl]) => {
          const on = (params?.status || "") === id;
          return <Link key={id} href={id ? `?status=${id}` : "?"} style={{ fontSize: 12.5, padding: "4px 11px", borderRadius: 7, textDecoration: "none", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--muted)" }}>{lbl}</Link>;
        })}
      </div>

      <CreateActionForm />

      <Panel title={`Actions (${actions.length})`}>
        <Table columns={[
          { label: "Action", render: (a) => <Link href={`/govern/actions/${a.action_id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{a.action_title}</Link> },
          { label: "Source", render: (a) => SOURCE_LABEL[a.source_type] || a.source_type || "—" },
          { label: "Owner", render: (a) => a.owner_name },
          { label: "Due", render: (a) => dateLabel(a.due_date) },
          { label: "Progress", align: "right", render: (a) => `${a.progress_pct ?? 0}%` },
          { label: "Expected", align: "right", render: (a) => (a.expected_value_gbp != null ? money(a.expected_value_gbp) : "—") },
          { label: "Status", render: (a) => <ActionStatusChip status={a.status} /> },
        ]} rows={actions} empty="No actions in this view. Approve an agent output or raise one above." />
      </Panel>
    </div>
  );
}
