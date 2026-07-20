import { query } from "./db";
import { getWindows, getPeriodSummary, getFyPlanTotal } from "./store-sales";
import { getExecutiveKpis, formatKpi } from "./finance-os";
import { getWeekStats, mondayOf } from "./workflow";
import { getReviewQueue as agentReviewQueue, getRecentExceptions } from "./agents";
import { getActionSummary, listActions } from "./actions";

/*
 * Executive Intelligence Hub — the HOME pillar data layer.
 *
 * This module does not query trading logic of its own: it composes the governed
 * modules (store sales, KPIs, workflow, agents, actions) into one exception-led
 * view. Honesty rule: every figure is tagged with its source and as-at date.
 * Real trading numbers come from the store feed; group-finance figures are still
 * illustrative demo data until the Xero feed lands (Phase 6) and are labelled so.
 */

const SEV_RANK = { CRITICAL: 0, RED: 1, HIGH: 2, AMBER: 3, MEDIUM: 4, LOW: 5, INFO: 6 };

// KPI domain -> the dashboard that owns it, so an exception deep-links to source.
const DOMAIN_ROUTE = {
  MANAGEMENT_ACCOUNTS: "/finance-os/management-accounts",
  STORES: "/finance-os/store-sales",
  INVENTORY: "/finance-os/inventory",
  CASHFLOW: "/finance-os/cashflow",
  FRANCHISE: "/finance-os/franchise",
  FIXED_ASSETS: "/finance-os/fixed-assets",
  STRATEGY: "/finance-os/budget-forecast",
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const dateShort = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
// Compact £ for the natural-language detail lines the feed assembles here.
const gbp = (n) => {
  const v = Number(n || 0), s = v < 0 ? "−" : "", a = Math.abs(v);
  if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${s}£${Math.round(a / 1e3).toLocaleString("en-GB")}k`;
  return `${s}£${Math.round(a).toLocaleString("en-GB")}`;
};

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { console.error("hub source failed:", e.message); return fallback; }
}

// Group-finance snapshot (illustrative until Xero): cash, facility headroom, inventory + their dates.
async function financeSnapshot() {
  const { rows } = await query(
    `SELECT
       c.available_cash, c.total_headroom, c.calendar_date AS finance_date,
       (SELECT SUM(stock_value) FROM intelligence.vw_inventory_health
         WHERE calendar_date = (SELECT MAX(calendar_date) FROM intelligence.vw_inventory_health)) AS inventory
     FROM intelligence.vw_cash_headroom c
     WHERE c.calendar_date = (SELECT MAX(calendar_date) FROM intelligence.vw_cash_headroom)`
  );
  return rows[0] || null;
}

async function overdueCriticalTasks() {
  const { rows } = await query(
    `SELECT task_id, title, due_date, priority FROM workflow.task_instance
     WHERE status = 'OVERDUE' AND priority IN ('CRITICAL','HIGH')
     ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 ELSE 1 END, due_date LIMIT 6`
  );
  return rows;
}

export async function getHubData() {
  const weekStart = mondayOf(todayIso());
  const windows = await safe(getWindows, null);

  const [ytd, fyPlan, kpis, fin, weekStats, agentQueue, agentExceptions, actionSummary, actions, overdueTasks] =
    await Promise.all([
      windows ? safe(() => getPeriodSummary(windows.ytd), null) : Promise.resolve(null),
      windows ? safe(getFyPlanTotal, 0) : Promise.resolve(0),
      safe(getExecutiveKpis, []),
      safe(financeSnapshot, null),
      safe(() => getWeekStats(weekStart), {}),
      safe(agentReviewQueue, []),
      safe(() => getRecentExceptions(20), []),
      safe(getActionSummary, {}),
      safe(() => listActions({}), []),
      safe(overdueCriticalTasks, []),
    ]);

  const tradingAsAt = windows?.maxDate || null;
  const financeAsAt = fin?.finance_date || (kpis.length ? kpis.map((k) => k.calendar_date).sort().at(-1) : null);

  // ---------------------------------------------------------------- hero band
  const ebitda = kpis.find((k) => k.kpi_code === "EBITDA_V_FORECAST");
  const hero = [];
  if (windows && ytd) {
    const lflGrowth = Number(ytd.lfl_py_net) ? Number(ytd.lfl_net) / Number(ytd.lfl_py_net) - 1 : null;
    const gm = Number(ytd.net) ? Number(ytd.gm) / Number(ytd.net) : null;
    hero.push({
      key: "revenue", label: "Revenue · YTD", unit: "GBP", value: Number(ytd.net),
      sub: lflGrowth != null ? `Like-for-like ${(lflGrowth * 100).toFixed(1)}% vs last year` : "Year to date",
      subTone: lflGrowth != null ? (lflGrowth >= 0 ? "green" : "red") : null,
      source: "STORE", href: "/finance-os/store-sales",
    });
    hero.push({
      key: "gm", label: "Gross margin · YTD", unit: "PCT", value: gm,
      sub: `${gbp(ytd.gm)} gross profit`, source: "STORE", href: "/finance-os/store-sales",
    });
  } else {
    for (const [key, label] of [["revenue", "Revenue · YTD"], ["gm", "Gross margin · YTD"]]) {
      hero.push({ key, label, unit: null, value: null, sub: "Awaiting store feed", source: "STORE", href: "/finance-os/store-sales" });
    }
  }
  hero.push({
    key: "ebitda", label: "EBITDA · latest month", unit: "GBP",
    value: ebitda ? Number(ebitda.actual_value) : null,
    sub: ebitda ? `Target ${gbp(ebitda.target_value)}` : "Awaiting feed",
    tone: ebitda ? { GREEN: "green", AMBER: "amber", RED: "red" }[ebitda.status] : null,
    source: "ILLUSTRATIVE", href: "/finance-os/management-accounts",
  });
  hero.push({
    key: "cash", label: "Cash available", unit: "GBP", value: fin ? Number(fin.available_cash) : null,
    sub: "Bank balance", source: "ILLUSTRATIVE", href: "/finance-os/cashflow",
  });
  hero.push({
    key: "headroom", label: "Facility headroom", unit: "GBP", value: fin ? Number(fin.total_headroom) : null,
    sub: "Undrawn committed", source: "ILLUSTRATIVE", href: "/finance-os/cashflow",
  });
  hero.push({
    key: "inventory", label: "Inventory value", unit: "GBP", value: fin ? Number(fin.inventory) : null,
    sub: "Stock on hand", source: "ILLUSTRATIVE", href: "/finance-os/inventory",
  });

  // ---------------------------------------------------------------- forward view
  let forward = null;
  if (windows && ytd) {
    const ytdNet = Number(ytd.net), plan = Number(fyPlan), fcYtd = Number(ytd.forecast);
    const start = new Date(windows.ytd.fromDate), end = new Date(windows.ytd.toDate);
    const daysElapsed = Math.round((end - start) / 86400000) + 1;
    forward = {
      ytdNet, plan, fcYtd,
      pctOfPlan: plan ? ytdNet / plan : null,
      vsForecast: fcYtd ? ytdNet / fcYtd - 1 : null,
      projectedFy: daysElapsed ? Math.round((ytdNet / daysElapsed) * 365) : null,
    };
  }

  // ---------------------------------------------------------------- attention feed
  const attention = [];
  for (const k of kpis) {
    if (k.status === "RED" || k.status === "AMBER") {
      attention.push({
        severity: k.status, kind: "KPI",
        headline: `${k.kpi_name}: ${k.status === "RED" ? "off target" : "watch"}`,
        detail: `Actual ${formatKpi(k.actual_value, k.unit_of_measure)} vs target ${formatKpi(k.target_value, k.unit_of_measure)}`,
        href: DOMAIN_ROUTE[k.dashboard_domain] || "/finance-os",
        tag: `KPI · ${dateShort(k.calendar_date)}`,
      });
    }
  }
  for (const o of agentQueue.slice(0, 5)) {
    attention.push({
      severity: o.severity || "MEDIUM", kind: "AGENT_REVIEW", headline: o.headline,
      detail: `${o.agent_name} — awaiting human sign-off${o.financial_impact != null ? ` · ${gbp(o.financial_impact)} impact` : ""}`,
      href: "/ai/review", tag: "AI agent · review",
    });
  }
  for (const e of agentExceptions) {
    attention.push({
      severity: e.severity || "HIGH", kind: "AGENT_EXCEPTION",
      headline: (e.message || "Agent exception").slice(0, 90),
      detail: `${e.agent_code} run raised an exception`, href: "/ai", tag: "AI agent · exception",
    });
  }
  for (const t of overdueTasks) {
    attention.push({
      severity: t.priority === "CRITICAL" ? "CRITICAL" : "HIGH", kind: "TASK",
      headline: `Overdue: ${t.title}`, detail: `Due ${dateShort(t.due_date)} · ${t.priority.toLowerCase()} priority`,
      href: "/perform/schedule", tag: "Schedule · overdue",
    });
  }
  for (const a of actions) {
    const v = Number(a.expected_value_gbp || 0);
    const open = ["OPEN", "IN_PROGRESS", "OVERDUE"].includes(a.status);
    if (a.status === "OVERDUE") {
      attention.push({ severity: "HIGH", kind: "ACTION", headline: `Overdue action: ${a.action_title}`,
        detail: `Owner ${a.owner_name}${v ? ` · ${gbp(v)} expected` : ""}`, href: `/govern/actions/${a.action_id}`, tag: "Action · overdue" });
    } else if (open && v >= 100000) {
      attention.push({ severity: v >= 250000 ? "HIGH" : "AMBER", kind: "ACTION", headline: `Open action: ${a.action_title}`,
        detail: `Owner ${a.owner_name} · ${gbp(v)} expected${a.due_date ? ` · due ${dateShort(a.due_date)}` : ""}`,
        href: `/govern/actions/${a.action_id}`, tag: "Action · high value" });
    } else if (a.status === "COMPLETE") {
      attention.push({ severity: "AMBER", kind: "ACTION", headline: `Awaiting closure: ${a.action_title}`,
        detail: `Completed by ${a.owner_name} — needs closure approval`, href: `/govern/actions/${a.action_id}`, tag: "Action · closure" });
    }
  }
  attention.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));

  // ---------------------------------------------------------------- health panels
  const ragCounts = { GREEN: 0, AMBER: 0, RED: 0, INFO: 0 };
  for (const k of kpis) ragCounts[k.status || "INFO"]++;

  const health = {
    actions: {
      open: Number(actionSummary.open || 0), overdue: Number(actionSummary.overdue || 0),
      awaitingClosure: Number(actionSummary.awaiting_closure || 0), openValue: Number(actionSummary.open_value || 0),
    },
    operations: {
      weekStart, total: Number(weekStats.total || 0), complete: Number(weekStats.complete || 0),
      overdue: Number(weekStats.overdue || 0), awaitingReview: Number(weekStats.awaiting_review || 0),
      blocked: Number(weekStats.blocked || 0),
    },
    agents: {
      pendingReviews: agentQueue.length, pendingMaterial: agentQueue.filter((o) => o.is_material).length,
      openExceptions: agentExceptions.length,
    },
  };

  return { tradingAsAt, financeAsAt, hero, forward, ragCounts, attention, health };
}
