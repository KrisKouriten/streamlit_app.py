import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../lib/auth";
import { getWeekTasks, getWeekStats, escalateOverdue, mondayOf } from "../../../lib/workflow";
import { StatusChip, PriorityMark, TaskActionButtons } from "../task-ui";
import { SubNav } from "../../finance-os/ui";
import { SCHEDULE_NAV } from "../nav";

export const dynamic = "force-dynamic";



const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fmtDay = (d) => { const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }); };

export default async function MyWeek({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params?.week || "") ? mondayOf(params.week) : mondayOf(new Date().toISOString().slice(0, 10));

  await escalateOverdue(); // keep OVERDUE statuses honest on every view
  const [tasks, stats] = await Promise.all([
    getWeekTasks(week, { userId: session.id }),
    getWeekStats(week),
  ]);
  const prev = new Date(new Date(week + "T00:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const next = new Date(new Date(week + "T00:00:00Z").getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const byDay = {};
  for (const t of tasks) (byDay[t.due_date instanceof Date ? t.due_date.toISOString().slice(0, 10) : String(t.due_date).slice(0, 10)] ||= []).push(t);
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const mineMinutes = tasks.filter((t) => t.assigned_to === session.id && t.status !== "CANCELLED").reduce((s, t) => s + (t.est_minutes || 0), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Perform · Weekly schedule</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>My Finance Week</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <Link href={`?week=${prev}`} style={{ textDecoration: "none" }}>← previous</Link>
          <span style={{ color: "var(--muted)" }}>w/c {fmtDay(week)}</span>
          <Link href={`?week=${next}`} style={{ textDecoration: "none" }}>next →</Link>
        </div>
      </header>
      <SubNav items={SCHEDULE_NAV} active="/perform/my-week" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 22 }}>
        {[["Week tasks", stats.total], ["Complete", stats.complete], ["Awaiting review", stats.awaiting_review],
          ["Overdue", stats.overdue], ["My estimated load", `${Math.round(mineMinutes / 60 * 10) / 10}h`]].map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: l === "Overdue" && v > 0 ? "var(--red)" : "var(--ink)" }}>{v}</div>
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", fontSize: 14, color: "var(--muted)" }}>
          No tasks for this week yet.{isManager ? " Generate the week from the Team schedule page." : " Your manager hasn't generated this week's tasks yet."}
        </div>
      )}

      {Object.entries(byDay).map(([day, dayTasks]) => (
        <section key={day} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 8px" }}>{fmtDay(day)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dayTasks.map((t) => (
              <div key={t.task_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <StatusChip status={t.status} />
                <Link href={`/perform/tasks/${t.task_id}`} style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", textDecoration: "none", flex: 1, minWidth: 180 }}>{t.title}</Link>
                <PriorityMark priority={t.priority} />
                {t.est_minutes && <span style={{ fontSize: 12, color: "var(--faint)" }}>{t.est_minutes}m</span>}
                <span style={{ fontSize: 12, color: "var(--faint)" }}>{t.assignee_name || "unassigned"}</span>
                <TaskActionButtons task={t} meId={session.id} isManager={isManager} compact />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
        Shows your tasks plus unassigned ones you can take. Completing a task and reviewer approval are separate steps — submitted tasks appear in the Review queue.
      </div>
    </div>
  );
}
