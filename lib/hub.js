import { getWindows, getPeriodSummary, getFyPlanTotal } from "./store-sales";
import { getExecutiveKpis, getRealFinanceSnapshot, getConnectedEntities } from "./finance-os";
import { listPos } from "./purchase-orders";
import { getProcurement } from "./procurement";
import { departmentBudgetPositions } from "./dept-budget-dashboard";
import { poAttention, procurementAttention, deptBudgetAttention, procurementBudgetAttention, rankAttention } from "./hub-attention-rules.js";

/*
 * Executive Intelligence Hub — the HOME pillar data layer.
 *
 * This module does not query trading logic of its own: it composes the governed
 * modules (store sales, KPIs, workflow, agents, actions) into one exception-led
 * view. Honesty rule: every figure is tagged with its source and as-at date.
 * Real trading numbers come from the store feed; group-finance figures are still
 * illustrative demo data until the Xero feed lands (Phase 6) and are labelled so.
 */


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

export async function getHubData() {
  const windows = await safe(getWindows, null);

  const thisYear = new Date().getFullYear();
  const [ytd, fyPlan, kpis, xero, financeScope, poPending, procurement, deptPositions] =
    await Promise.all([
      windows ? safe(() => getPeriodSummary(windows.ytd), null) : Promise.resolve(null),
      windows ? safe(() => getFyPlanTotal(Number(String(windows.ytd.fromDate).slice(0, 4))), 0) : Promise.resolve(0),
      safe(getExecutiveKpis, []),
      safe(getRealFinanceSnapshot, null),
      safe(getConnectedEntities, { count: 0, entities: [] }),
      safe(() => listPos({ status: "PENDING_SIGNOFF", limit: 500 }), { pos: [] }),
      safe(getProcurement, null),
      safe(() => departmentBudgetPositions(thisYear), []),
    ]);

  const tradingAsAt = windows?.maxDate || null;
  const financeAsAt = xero?.asAt || null;

  // ---------------------------------------------------------------- hero band
  // Two trading tiles from the store feed (all stores) + four statutory-finance
  // tiles from Xero (connected entities only). The source chips keep the two
  // scopes from ever being read as the same number.
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
  if (xero) {
    hero.push({ key: "x_rev", label: "Revenue", unit: "GBP", value: xero.revenue, sub: "Connected entities", source: "XERO", href: "/finance-os/management-accounts" });
    hero.push({ key: "x_gp", label: "Gross profit", unit: "GBP", value: xero.grossProfit, sub: xero.grossMargin != null ? `${(xero.grossMargin * 100).toFixed(1)}% margin` : "—", source: "XERO", href: "/finance-os/management-accounts" });
    hero.push({ key: "x_net", label: "Net result", unit: "GBP", value: xero.netResult, sub: "before tax", tone: xero.netResult >= 0 ? "green" : "red", source: "XERO", href: "/finance-os/management-accounts" });
    hero.push({ key: "x_cash", label: "Cash at bank", unit: "GBP", value: xero.cash, sub: "reconciled", source: "XERO", href: "/finance-os/cashflow" });
  } else {
    for (const [key, label] of [["x_rev", "Revenue"], ["x_gp", "Gross profit"], ["x_net", "Net result"], ["x_cash", "Cash at bank"]]) {
      hero.push({ key, label, unit: null, value: null, sub: "Awaiting Joiin feed", source: "XERO", href: "/finance-os/management-accounts" });
    }
  }

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
  // Only what someone has to act on, from live sources: P.Os awaiting sign-off,
  // procurement requests not yet approved, and budgets overspent. KPI tiles,
  // AI-agent outputs, schedule tasks and actions are no longer fed in — they
  // were not being maintained, so the feed filled with items nobody could act
  // on. See lib/hub-attention-rules.js.
  const fromYm = `${thisYear}-01`;
  const attention = rankAttention([
    ...deptBudgetAttention(deptPositions),
    ...procurementBudgetAttention(procurement?.summary || null, fromYm),
    ...poAttention(poPending?.pos || []),
    ...procurementAttention(procurement?.orders || []),
  ]);
  const attentionCounts = {
    budgets: attention.filter((a) => a.kind === "BUDGET").length,
    pos: attention.filter((a) => a.kind === "PO").length,
    procurement: attention.filter((a) => a.kind === "PROCUREMENT").length,
  };

  // ---------------------------------------------------------------- control panels
  // The same live sources as the feed, as totals. Agent, schedule and action
  // panels were dropped with them: they read data nobody was maintaining.
  const ragCounts = { GREEN: 0, AMBER: 0, RED: 0, INFO: 0 };
  for (const k of kpis) ragCounts[k.status || "INFO"]++;
  const pos = (poPending?.pos || []).filter((p) => p.status === "PENDING_SIGNOFF");
  const openProc = (procurement?.orders || []).filter((r) => r.approval_status === "PENDING" || r.approval_status === "HOD_APPROVED");
  const sumBy = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const procMonths = ["MINISO", "LOCAL"].flatMap((k) => (procurement?.summary?.[k]?.months || [])
    .filter((m) => m.budget != null && m.ym >= fromYm).map((m) => ({ ...m, key: k })));
  const deptWithBudget = (deptPositions || []).filter((p) => Number(p.proposed) > 0);
  const health = {
    approvals: {
      posPending: pos.length, posPendingValue: sumBy(pos, (p) => p.payment_value),
      procWithHod: openProc.filter((r) => r.approval_status === "PENDING").length,
      procWithFinance: openProc.filter((r) => r.approval_status === "HOD_APPROVED").length,
      procValue: sumBy(openProc, (r) => r.amount_gbp),
    },
    budgets: {
      deptCount: deptWithBudget.length,
      deptOver: deptWithBudget.filter((p) => Number(p.left) < 0).length,
      deptOverBy: sumBy(deptWithBudget.filter((p) => Number(p.left) < 0), (p) => -p.left),
      procMonths: procMonths.length,
      procMonthsOver: procMonths.filter((m) => m.overBudget).length,
      procOverBy: sumBy(procMonths.filter((m) => m.overBudget), (m) => -m.variance),
    },
  };

  return { tradingAsAt, financeAsAt, financeScope, hero, forward, ragCounts, attention, attentionCounts, health };
}
