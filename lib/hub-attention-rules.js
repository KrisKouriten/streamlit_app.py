/*
 * Executive Intelligence Hub — "Needs attention", pure and unit-testable.
 *
 * The feed carries only what someone has to act on today, from sources that are
 * live:
 *
 *   * P.Os awaiting department-head sign-off
 *   * procurement requests not yet approved (head of department, then Finance)
 *   * budgets overspent — each department's budget, and each month of the
 *     Miniso and Local procurement budgets
 *
 * It used to lead with KPI tiles, AI-agent outputs and schedule tasks, which
 * were not being maintained and so filled the page with items nobody could
 * act on. Those are gone from the feed.
 */

import { poRef } from "./po-rules.js";
import { procRef } from "./procurement-close-rules.js";

export const SEV_RANK = { CRITICAL: 0, RED: 1, HIGH: 2, AMBER: 3, MEDIUM: 4, LOW: 5, INFO: 6 };

// A request waiting this long is chased harder.
export const STALE_DAYS = 7;

const gbp = (n) => {
  const v = Number(n || 0), s = v < 0 ? "−" : "", a = Math.abs(v);
  if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${s}£${Math.round(a / 1e3).toLocaleString("en-GB")}k`;
  return `${s}£${Math.round(a).toLocaleString("en-GB")}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymLabel = (ym) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(ym || "");
};

// Whole days from a timestamp to today. Null when there is no date.
export function daysWaiting(since, today = new Date()) {
  if (!since) return null;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return null;
  const t = today instanceof Date ? today : new Date(today);
  return Math.max(0, Math.floor((t - d) / 86400000));
}
const waited = (n) => (n == null ? "" : n === 0 ? "raised today" : `waiting ${n} day${n === 1 ? "" : "s"}`);

/*
 * P.Os awaiting department-head sign-off, oldest first.
 *   pos: rows of finance.purchase_order
 */
export function poAttention(pos = [], today = new Date()) {
  return (pos || [])
    .filter((p) => p.status === "PENDING_SIGNOFF")
    .map((p) => {
      const days = daysWaiting(p.updated_at || p.created_at, today);
      return {
        severity: days != null && days >= STALE_DAYS ? "HIGH" : "AMBER",
        kind: "PO",
        headline: `P.O awaiting sign-off: ${poRef(p)} · ${p.supplier || "no supplier"}`,
        detail: [p.department, gbp(p.payment_value), waited(days)].filter(Boolean).join(" · "),
        href: "/operate/po-tracker",
        tag: "P.O · sign-off",
        _days: days ?? 0,
      };
    })
    .sort((a, b) => b._days - a._days);
}

/*
 * Procurement requests not yet approved: PENDING is with the head of
 * department, HOD_APPROVED with Finance. Cancelled and approved drop out.
 *   rows: rows of finance.procurement_purchase
 */
export function procurementAttention(rows = [], today = new Date()) {
  return (rows || [])
    .filter((r) => r.approval_status === "PENDING" || r.approval_status === "HOD_APPROVED")
    .map((r) => {
      const withFinance = r.approval_status === "HOD_APPROVED";
      const days = daysWaiting(withFinance ? (r.hod_approved_at || r.created_at) : r.created_at, today);
      const src = r.source === "MINISO" ? "Miniso" : r.source === "LOCAL" ? "Local" : (r.source || "");
      return {
        severity: days != null && days >= STALE_DAYS ? "HIGH" : "AMBER",
        kind: "PROCUREMENT",
        headline: `Procurement request not approved: ${procRef(r)} · ${r.supplier || "no supplier"}`,
        detail: [src, gbp(r.amount_gbp), withFinance ? "with Finance" : "with head of department", waited(days)].filter(Boolean).join(" · "),
        href: "/operate/procurement",
        tag: withFinance ? "Procurement · Finance" : "Procurement · head of dept",
        _days: days ?? 0,
      };
    })
    .sort((a, b) => b._days - a._days);
}

/*
 * Department budgets overspent.
 *   positions: [{ department, budgetLabel, proposed, committed, open, left }]
 * `left` is the dashboard's own Budget remaining (proposed − committed − open
 * P.Os); below zero is over. Committed alone over the budget is CRITICAL — the
 * money has gone — and committed plus open P.Os over it is HIGH.
 */
export function deptBudgetAttention(positions = []) {
  const out = [];
  for (const p of positions || []) {
    if (!(Number(p.proposed) > 0) || p.left == null || Number(p.left) >= 0) continue;
    const spentOver = Number(p.committed) > Number(p.proposed);
    out.push({
      severity: spentOver ? "CRITICAL" : "HIGH",
      kind: "BUDGET",
      headline: `${p.department}${p.budgetLabel ? ` · ${p.budgetLabel}` : ""}: over budget by ${gbp(-Number(p.left))}`,
      detail: `Budget ${gbp(p.proposed)} · committed ${gbp(p.committed)}${Number(p.open) ? ` · open P.Os ${gbp(p.open)}` : ""}`,
      href: `/dashboards/department-budget?dept=${encodeURIComponent(p.department)}`,
      tag: "Budget · department",
      _over: -Number(p.left),
    });
  }
  return out.sort((a, b) => b._over - a._over);
}

/*
 * Procurement budget months overspent, Miniso and Local separately — each is its
 * own budget. Over means committed + spent (less the FX held in committed)
 * exceeds the month's budget, the same test as the Procurement Requests table;
 * spent alone over it is CRITICAL. Months before `fromYm` are left out: a month
 * that has closed cannot be brought back within budget.
 *   summary: getProcurement().summary — { MINISO: { months }, LOCAL: { months } }
 */
export function procurementBudgetAttention(summary = null, fromYm = null) {
  const out = [];
  const LABEL = { MINISO: "Miniso purchases", LOCAL: "Local purchases" };
  for (const key of Object.keys(LABEL)) {
    for (const m of summary?.[key]?.months || []) {
      if (!m.overBudget || m.budget == null) continue;
      if (fromYm && m.ym < fromYm) continue;
      const over = -Number(m.variance) || 0;
      out.push({
        severity: m.overSpent ? "CRITICAL" : "HIGH",
        kind: "BUDGET",
        headline: `${LABEL[key]} · ${ymLabel(m.ym)}: over budget by ${gbp(over)}`,
        detail: `Budget ${gbp(m.budget)} · committed ${gbp(m.committed)} · spent ${gbp(m.spent)}`,
        href: "/operate/procurement",
        tag: "Budget · procurement",
        _over: over,
      });
    }
  }
  return out.sort((a, b) => b._over - a._over);
}

// Budgets first (overspend is the most serious), then approvals waiting, each
// by severity; stable within a severity so the builders' own order holds.
export function rankAttention(items = []) {
  const KIND = { BUDGET: 0, PO: 1, PROCUREMENT: 2 };
  return [...items]
    .map((x, i) => ({ x, i }))
    .sort((a, b) =>
      (SEV_RANK[a.x.severity] ?? 9) - (SEV_RANK[b.x.severity] ?? 9)
      || (KIND[a.x.kind] ?? 9) - (KIND[b.x.kind] ?? 9)
      || a.i - b.i)
    .map(({ x }) => { const { _days, _over, ...rest } = x; return rest; });
}
