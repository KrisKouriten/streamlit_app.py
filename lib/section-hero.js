import { getHubData } from "./hub";

/*
 * Per-section hero stats for the section / pillar hubs. Composed from the SAME
 * governed aggregates the Executive hub uses (lib/hub.js) — one call, sliced by
 * section — so nothing is invented and every tile degrades to "Awaiting feed"
 * when its source isn't loaded. Returns { stats:[…], caption }.
 *
 * stat shape: { key, label, unit(GBP|PCT|NUM|null), value, sub, subTone, tone,
 * source(STORE|XERO|TASKS|AGENTS|ACTIONS|KPI), href }.
 */

const tile = (key, label, unit, value, sub, source, href, extra = {}) =>
  ({ key, label, unit, value: value ?? null, sub, source, href, ...extra });

const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : null);

export async function getSectionHero(sectionKey) {
  let d = null;
  try { d = await getHubData(); } catch { d = null; }
  if (!d) return { stats: [], caption: null };

  const byKey = Object.fromEntries((d.hero || []).map((h) => [h.key, h]));
  const asHero = (k) => {
    const h = byKey[k];
    return h ? { key: h.key, label: h.label, unit: h.unit, value: h.value, sub: h.sub, subTone: h.subTone, tone: h.tone, source: h.source, href: h.href } : null;
  };
  const H = d.health || {};
  const caption = d.financeAsAt
    ? `Group finance to ${dmy(d.financeAsAt)}`
    : (d.tradingAsAt ? `Store data to ${dmy(d.tradingAsAt)}` : null);

  switch (sectionKey) {
    case "home":
    case "dashboards":
      return { stats: ["revenue", "gm", "x_net", "x_cash"].map(asHero).filter(Boolean), caption };

    case "perform":
      return { stats: ["x_rev", "x_gp", "x_net", "revenue"].map(asHero).filter(Boolean), caption };

    case "plan-finance":
    case "plan-ho": {
      const f = d.forward;
      if (!f) return { stats: [tile("plan", "FY plan", null, null, "Awaiting store feed", "STORE", "/finance-os/budget-forecast")], caption };
      const stats = [
        tile("ytd", "Revenue · YTD", "GBP", f.ytdNet, "Year to date", "STORE", "/finance-os/store-sales"),
        tile("pctplan", "% of FY plan", "PCT", f.pctOfPlan, "YTD vs full-year plan", "STORE", "/finance-os/budget-forecast"),
        tile("proj", "Projected FY", "GBP", f.projectedFy, "Run-rate projection", "STORE", "/finance-os/budget-forecast"),
      ];
      if (f.vsForecast != null) {
        stats.push(tile("vsfc", "vs Forecast", "PCT", f.vsForecast, "YTD actual vs forecast", "STORE", "/operate/forecast",
          { subTone: f.vsForecast >= 0 ? "green" : "red", tone: f.vsForecast >= 0 ? "green" : "red" }));
      }
      return { stats, caption };
    }

    case "operate": {
      const o = H.operations || {}, a = H.actions || {};
      return { stats: [
        tile("tasks", "Tasks this week", "NUM", o.total, `${o.complete || 0} complete · ${o.overdue || 0} overdue`, "TASKS", "/perform/my-week", { tone: (o.overdue || 0) > 0 ? "amber" : null }),
        tile("review", "Awaiting review", "NUM", o.awaitingReview, "Submitted work to approve", "TASKS", "/perform/review"),
        tile("actions", "Open actions", "NUM", a.open, `${a.overdue || 0} overdue`, "ACTIONS", "/govern/actions", { tone: (a.overdue || 0) > 0 ? "amber" : null }),
        tile("actval", "Open action value", "GBP", a.openValue, "Expected £ in flight", "ACTIONS", "/govern/actions"),
      ], caption: null };
    }

    case "dft": {
      const ag = H.agents || {};
      return { stats: [
        tile("rev", "Reviews awaiting", "NUM", ag.pendingReviews, `${ag.pendingMaterial || 0} material`, "AGENTS", "/ai/review", { tone: (ag.pendingReviews || 0) > 0 ? "amber" : null }),
        tile("exc", "Open exceptions", "NUM", ag.openExceptions, "Agent-raised", "AGENTS", "/ai", { tone: (ag.openExceptions || 0) > 0 ? "amber" : null }),
      ], caption: null };
    }

    case "govern": {
      const a = H.actions || {}, rc = d.ragCounts || {};
      return { stats: [
        tile("open", "Open actions", "NUM", a.open, `${a.awaitingClosure || 0} awaiting closure`, "ACTIONS", "/govern/actions"),
        tile("kpiRed", "KPIs off target", "NUM", rc.RED || 0, `${rc.AMBER || 0} on watch`, "KPI", "/finance-os/executive", { tone: (rc.RED || 0) > 0 ? "red" : null }),
      ], caption: null };
    }

    case "data":
      return { stats: [
        tile("trade", "Trading feed", "GBP", byKey.revenue?.value ?? null, d.tradingAsAt ? `as at ${dmy(d.tradingAsAt)}` : "Awaiting store feed", "STORE", "/data/uploads"),
        tile("fin", "Group finance", "GBP", byKey.x_rev?.value ?? null, d.financeAsAt ? `as at ${dmy(d.financeAsAt)}` : "Awaiting Joiin feed", "XERO", "/data/uploads"),
      ], caption: null };

    default:
      return { stats: [], caption: null };
  }
}
