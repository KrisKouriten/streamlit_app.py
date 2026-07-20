import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listTemplates } from "../../../lib/workflow";
import { SubNav, Panel, Table } from "../../finance-os/ui";
import { SCHEDULE_NAV } from "../nav";
import { PriorityMark } from "../task-ui";

export const dynamic = "force-dynamic";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function TaskLibrary() {
  const session = await getSession();
  if (!session) redirect("/login");
  const templates = await listTemplates();

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Perform · Weekly schedule</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Task library</div>
      </header>
      <SubNav items={SCHEDULE_NAV} active="/perform/library" />

      <Panel title={`Recurring templates (${templates.length})`} note="each generates a dated task when the week is generated">
        <Table columns={[
          { label: "Task", render: (t) => t.title },
          { label: "Frequency", render: (t) => t.frequency === "WEEKLY" ? `Weekly · ${DAYS[t.due_weekday] ?? ""}` : t.frequency === "MONTHLY" ? `Monthly · day ${t.due_day}` : "Ad hoc" },
          { label: "Priority", render: (t) => <PriorityMark priority={t.priority} /> },
          { label: "Est", align: "right", render: (t) => t.est_minutes ? `${t.est_minutes}m` : "—" },
          { label: "Default assignee", render: (t) => t.default_assignee_name || "—" },
          { label: "Review?", render: (t) => t.requires_review ? "Yes" : "No" },
          { label: "Evidence?", render: (t) => t.requires_evidence ? "Required" : "—" },
          { label: "Linked dashboard", render: (t) => t.dashboard_code || "—" },
          { label: "Active", render: (t) => t.is_active ? "Yes" : "No" },
        ]} rows={templates} />
      </Panel>
      <div style={{ fontSize: 12, color: "var(--faint)" }}>
        Template editing from this screen arrives with the next iteration — for now ask your administrator to adjust templates.
      </div>
    </div>
  );
}
