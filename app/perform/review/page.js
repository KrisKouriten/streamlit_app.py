import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../lib/auth";
import { getReviewQueue } from "../../../lib/workflow";
import { PriorityMark } from "../task-ui";
import { SubNav } from "../../finance-os/ui";
import { SCHEDULE_NAV } from "../nav";
import ReviewButtons from "./review-buttons";

export const dynamic = "force-dynamic";

const fmtDay = (d) => { const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };

export default async function ReviewQueue() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const rows = (await getReviewQueue(session.id, isManager)).filter((t) => t.assigned_to !== session.id);
  const own = (await getReviewQueue(session.id, isManager)).filter((t) => t.assigned_to === session.id);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Perform · Weekly schedule</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Task review queue</div>
      </header>
      <SubNav items={SCHEDULE_NAV} active="/perform/review" />

      {rows.length === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", fontSize: 14, color: "var(--muted)" }}>
          Nothing waiting for your review. {own.length > 0 ? `(${own.length} of your own submissions are awaiting another reviewer.)` : ""}
        </div>
      )}
      {rows.map((t) => (
        <div key={t.task_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Link href={`/perform/tasks/${t.task_id}`} style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", textDecoration: "none", flex: 1, minWidth: 200 }}>{t.title}</Link>
          <span style={{ fontSize: 12, color: "var(--faint)" }}>due {fmtDay(t.due_date)}</span>
          <PriorityMark priority={t.priority} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t.assignee_name}</span>
          <ReviewButtons taskId={t.task_id} />
        </div>
      ))}
      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
        Open the task to check evidence and history before deciding. You cannot approve your own submissions.
      </div>
    </div>
  );
}
