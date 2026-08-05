import { getHubData } from "./hub";
import { getReviewQueue as taskReviewQueue, getWeekTasks, getWeekStats, mondayOf } from "./workflow";
import { getReviewQueue as agentReviewQueue } from "./agents";
import { listReports } from "./reporting/reports";
import { unreadCountFor } from "./notifications";
import { listBriefings } from "./intelligence/briefing";
import { getMyActionsSummary } from "./personal";

/*
 * My Finance Home — the personal landing page. It composes the SAME governed
 * feeds the rest of the platform uses (hub, task/agent review queues, actions,
 * reports, notifications, briefings) into one "here's your day" view. No trading
 * logic of its own and no new store: every count and row is a slice of an
 * existing service, each call wrapped so one dead feed never blanks the page.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

export function greeting(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export async function getMyHome(session) {
  const isManager = (session.roles || []).some((r) => r === "ADMIN" || r === "FINANCE");
  const weekStart = mondayOf(todayIso());

  const [hub, taskReviews, agentReviews, myTasks, weekStats, reportsRes, unread, briefings, myActions] = await Promise.all([
    safe(getHubData, {}),
    safe(() => taskReviewQueue(session.id, isManager), []),
    safe(agentReviewQueue, []),
    safe(() => getWeekTasks(weekStart, { userId: session.id }), []),
    safe(() => getWeekStats(weekStart), {}),
    safe(() => listReports({ limit: 6 }), { reports: [] }),
    safe(() => unreadCountFor(session.id), 0),
    safe(() => listBriefings(1), []),
    safe(() => getMyActionsSummary(session.id), { open: 0, overdue: 0 }),
  ]);

  const attention = hub.attention || [];
  const health = hub.health || {};
  const actions = health.actions || {};

  const critical = attention.filter((a) => a.severity === "CRITICAL" || a.severity === "RED").length;
  const reports = reportsRes.reports || [];
  const draftReports = reports.filter((r) => r.status === "DRAFT" || r.status === "IN_REVIEW").length;

  // Unified approvals queue: task reviews + agent reviews (+ action closures as a count).
  const approvals = [
    ...taskReviews.map((t) => ({ kind: "Task review", title: t.title, href: `/perform/tasks/${t.task_id}`, meta: t.due_date ? `due ${new Date(t.due_date).toLocaleDateString("en-GB")}` : null })),
    ...agentReviews.map((o) => ({ kind: "Agent review", title: o.headline, href: "/ai/review", meta: o.agent_name || null })),
  ];
  const approvalsCount = approvals.length + Number(actions.awaitingClosure || 0);

  const myOverdue = Number(myActions.overdue || 0);
  const counts = [
    { key: "crit", label: "Critical", unit: "NUM", value: critical, sub: "need you now", href: "/finance-os/executive", tone: critical > 0 ? "red" : null },
    { key: "mytasks", label: "My tasks", unit: "NUM", value: Number(myActions.open || 0), sub: myOverdue > 0 ? `${myOverdue} overdue` : "on track", href: "/finance-os/my-home", tone: myOverdue > 0 ? "red" : null, subTone: myOverdue > 0 ? "red" : null },
    { key: "actions", label: "Open actions", unit: "NUM", value: Number(actions.open || 0), sub: `${Number(actions.overdue || 0)} overdue`, href: "/govern/actions", source: "ACTIONS", tone: Number(actions.overdue || 0) > 0 ? "amber" : null },
    { key: "appr", label: "Approvals", unit: "NUM", value: approvalsCount, sub: "awaiting your sign-off", href: "/perform/review", tone: approvalsCount > 0 ? "amber" : null },
    { key: "ai", label: "AI recommendations", unit: "NUM", value: agentReviews.length, sub: "from the agents", href: "/ai/review", source: "AGENTS" },
    { key: "reports", label: "Reports in progress", unit: "NUM", value: draftReports, sub: "in the Reporting Centre", href: "/finance-os/home/reports" },
    { key: "notif", label: "Notifications", unit: "NUM", value: Number(unread || 0), sub: "unread", href: "/inbox", tone: Number(unread || 0) > 0 ? "amber" : null },
  ];

  const week = {
    total: Number(weekStats.total || 0), complete: Number(weekStats.complete || 0),
    overdue: Number(weekStats.overdue || 0),
    mine: (myTasks || []).filter((t) => t.status !== "COMPLETE" && t.status !== "APPROVED").slice(0, 5)
      .map((t) => ({ title: t.title, href: `/perform/tasks/${t.task_id}`, status: t.status, due: t.due_date })),
  };

  return {
    counts,
    attention: attention.slice(0, 8),
    approvals: approvals.slice(0, 6),
    week,
    reports: reports.slice(0, 5).map((r) => ({ id: r.report_id, title: r.title, status: r.status, period: r.reporting_period })),
    briefing: briefings[0] || null,
    financeAsAt: hub.financeAsAt || null,
    tradingAsAt: hub.tradingAsAt || null,
  };
}
