import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../../lib/auth";
import { getTask } from "../../../../lib/workflow";
import { StatusChip, PriorityMark, TaskActionButtons } from "../../task-ui";
import TaskPanels from "./panels";

export const dynamic = "force-dynamic";

const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function TaskDetail({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) notFound();
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const canReview = task.status === "READY_FOR_REVIEW" &&
    (isManager || task.reviewer_id === session.id) && task.assigned_to !== session.id;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/perform/my-week" style={{ textDecoration: "none", color: "var(--faint)" }}>Perform · Weekly schedule</Link> · Task
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{task.title}</span>
          <StatusChip status={task.status} />
          <PriorityMark priority={task.priority} />
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
        {[["Due", fmtDate(task.due_date)], ["Assignee", task.assignee_name || "unassigned"],
          ["Reviewer", task.reviewer_name || (task.requires_review ? "any manager" : "not required")],
          ["Estimated", task.est_minutes ? `${task.est_minutes}m` : "—"],
          ["Actual", task.actual_minutes ? `${task.actual_minutes}m` : "—"],
          ["Scope", task.store_name || task.entity_name || "Group"]].map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 13px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {task.description && (
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, marginBottom: 14 }}>{task.description}</p>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 18 }}>
        {task.sop_url && <a href={task.sop_url} target="_blank" rel="noreferrer">Linked SOP ↗</a>}
        {task.dashboard_code && <Link href={`/finance-os`}>Linked dashboard: {task.dashboard_code}</Link>}
        {task.dependencies.length > 0 && (
          <span style={{ color: "var(--muted)" }}>
            Depends on: {task.dependencies.map((d) => `${d.title} (${d.status})`).join(", ")}
          </span>
        )}
        {task.requires_evidence && <span style={{ color: "var(--amber)" }}>Evidence required before submission</span>}
      </div>

      <div style={{ marginBottom: 22 }}>
        <TaskActionButtons task={task} meId={session.id} isManager={isManager} />
      </div>

      <TaskPanels task={{
        task_id: task.task_id, status: task.status, requires_review: task.requires_review,
        evidence: task.evidence.map((e) => ({ ...e, added_at: String(e.added_at) })),
        comments: task.comments.map((c) => ({ ...c, created_at: String(c.created_at) })),
        reviews: task.reviews.map((r) => ({ ...r, decided_at: String(r.decided_at) })),
      }} canReview={canReview} />

      <section style={{ marginTop: 26 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Status history</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "6px 14px" }}>
          {task.history.map((h) => (
            <div key={h.history_id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <span style={{ color: "var(--faint)", minWidth: 120 }}>{fmt(h.changed_at)}</span>
              <span>{h.from_status ? `${h.from_status} → ` : ""}<strong>{h.to_status}</strong></span>
              <span style={{ color: "var(--muted)" }}>{h.changed_by}</span>
              {h.note && <span style={{ color: "var(--faint)" }}>· {h.note}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
