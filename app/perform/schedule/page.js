import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, hasRole } from "../../../lib/auth";
import { getTeamWeek, getWeekStats, escalateOverdue, mondayOf } from "../../../lib/workflow";
import { StatusChip, PriorityMark } from "../task-ui";
import { SubNav } from "../../finance-os/ui";
import { SCHEDULE_NAV } from "../nav";
import { GenerateWeek, AssignSelect } from "./controls";

export const dynamic = "force-dynamic";

const fmtDay = (d) => { const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };

export default async function TeamSchedule({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const params = await searchParams;
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params?.week || "") ? mondayOf(params.week) : mondayOf(new Date().toISOString().slice(0, 10));

  await escalateOverdue();
  const [{ tasks, capacity }, stats] = await Promise.all([getTeamWeek(week), getWeekStats(week)]);
  const prev = new Date(new Date(week + "T00:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const next = new Date(new Date(week + "T00:00:00Z").getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const byPerson = new Map(capacity.map((p) => [p.user_id, { ...p, tasks: [], minutes: 0 }]));
  const unassigned = [];
  for (const t of tasks) {
    if (t.status === "CANCELLED") continue;
    if (t.assigned_to && byPerson.has(t.assigned_to)) {
      const p = byPerson.get(t.assigned_to);
      p.tasks.push(t); p.minutes += t.est_minutes || 0;
    } else unassigned.push(t);
  }
  const pct = stats.total ? Math.round((stats.complete / stats.total) * 100) : 0;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Perform · Weekly schedule</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Finance Team Schedule</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <Link href={`?week=${prev}`} style={{ textDecoration: "none" }}>← previous</Link>
          <span style={{ color: "var(--muted)" }}>w/c {fmtDay(week)}</span>
          <Link href={`?week=${next}`} style={{ textDecoration: "none" }}>next →</Link>
        </div>
      </header>
      <SubNav items={SCHEDULE_NAV} active="/perform/schedule" />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        {isManager && <GenerateWeek week={week} />}
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Week completion: <strong>{pct}%</strong> ({stats.complete}/{stats.total}) · {stats.awaiting_review} awaiting review ·{" "}
          <span style={{ color: stats.overdue ? "#a32d2d" : "var(--muted)" }}>{stats.overdue} overdue</span> · {stats.blocked} blocked
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "var(--line)", overflow: "hidden", marginBottom: 24 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)" }} />
      </div>

      {unassigned.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)", marginBottom: 8 }}>UNASSIGNED ({unassigned.length})</div>
          {unassigned.map((t) => (
            <div key={t.task_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <StatusChip status={t.status} />
              <Link href={`/perform/tasks/${t.task_id}`} style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", textDecoration: "none", flex: 1, minWidth: 160 }}>{t.title}</Link>
              <span style={{ fontSize: 12, color: "var(--faint)" }}>{fmtDay(t.due_date)}</span>
              <PriorityMark priority={t.priority} />
              {isManager && <AssignSelect task={t} people={capacity} />}
            </div>
          ))}
        </section>
      )}

      {[...byPerson.values()].map((p) => {
        const loadPct = Math.min(100, Math.round((p.minutes / 60 / Number(p.weekly_hours)) * 100));
        return (
          <section key={p.user_id} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--faint)" }}>{Math.round(p.minutes / 60 * 10) / 10}h of {Number(p.weekly_hours)}h capacity</div>
              <div style={{ width: 120, height: 5, borderRadius: 99, background: "var(--line)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${loadPct}%`, background: loadPct > 85 ? "#a32d2d" : "var(--accent)" }} />
              </div>
            </div>
            {p.tasks.length === 0 && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>No tasks assigned this week.</div>}
            {p.tasks.map((t) => (
              <div key={t.task_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                <StatusChip status={t.status} />
                <Link href={`/perform/tasks/${t.task_id}`} style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", textDecoration: "none", flex: 1, minWidth: 160 }}>{t.title}</Link>
                <span style={{ fontSize: 12, color: "var(--faint)" }}>{fmtDay(t.due_date)}</span>
                <PriorityMark priority={t.priority} />
                {t.est_minutes && <span style={{ fontSize: 12, color: "var(--faint)" }}>{t.est_minutes}m</span>}
                {isManager && <AssignSelect task={t} people={capacity} />}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
