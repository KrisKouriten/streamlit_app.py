/*
 * Accrual review — pure rules. Given the uploaded store P&L actuals (store ×
 * nominal × month), reviews a target month against each line's trailing run-rate
 * (the average of the prior posted months in the same year) and flags where an
 * accrual is needed. The same completeness / drift logic as the pre-close engine,
 * but the run-rate is the expectation — which is what provisional store accounts
 * need at month-end. Unit-tested in tests/accrual-rules.test.mjs.
 */

import { classifyNominal } from "./actuals-rules.js";
import { expectedForMonth } from "./cost-model-rules.js";

// The three accrual signals, most-urgent first.
export const ACCRUAL_TYPES = [
  { code: "COMPLETENESS", label: "Nothing posted", tone: "red", hint: "The line ran every prior month but is £0 in this month — a full accrual is likely." },
  { code: "REVERSAL", label: "Reversal — re-accrue", tone: "amber", hint: "A prior accrual reversed this month and hasn't been re-posted." },
  { code: "DRIFT", label: "Under-posted", tone: "amber", hint: "Posted, but below the run-rate — a top-up accrual may be needed." },
];
export const DEFAULT_MATERIALITY = 250;

const round0 = (n) => Math.round(Number(n) || 0);

/*
 * records: [{ unit (store), line_label (nominal), ym 'YYYY-MM', value }].
 * targetMonth defaults to the latest month present. materiality is the £ gap below
 * which a line is ignored as noise.
 *
 * The expected figure for each store × nominal is, in order of preference:
 *   1. the uploaded fixed / variable cost model (`expectations`) — a FIXED
 *      monthly amount, or a VARIABLE rate applied to that store's target-month
 *      revenue. This is the "variance versus actuals" basis.
 *   2. the run-rate — mean of the target year's prior posted months — used where
 *      no model line is loaded.
 * The accrual is expected − posted where that gap clears materiality.
 */
export function computeAccrualReview(records = [], { targetMonth = null, materiality = DEFAULT_MATERIALITY, expectations = [] } = {}) {
  // Accept either an array of base expectations or { base, monthRates }.
  const base = Array.isArray(expectations) ? expectations : (expectations.base || []);
  const monthRates = Array.isArray(expectations) ? [] : (expectations.monthRates || []);
  const modelCount = base.length;

  const monthsAll = [...new Set(records.map((r) => r.ym).filter(Boolean))].sort();
  const target = targetMonth || monthsAll[monthsAll.length - 1] || null;
  const empty = {
    totals: { runRateCost: 0, targetCost: 0, totalAccrual: 0, flagged: 0 },
    byType: [], byNominal: [], byStore: [], lines: [],
    revenueMissing: { count: 0, runRate: 0, items: [] },
    basisCounts: { MODEL: 0, RUN_RATE: 0 }, modelLoaded: modelCount > 0,
  };
  if (!target) return { ready: false, target: null, months: monthsAll, priorMonths: [], materiality, ...empty };

  const year = target.slice(0, 4);
  const mm = target.slice(5, 7);
  const priorMonths = monthsAll.filter((m) => m.slice(0, 4) === year && m < target);

  // Model expectations keyed store||nominal, plus month-varying rates. For the
  // target month, an absolute-month (YM) override wins over a calendar-month
  // (MONTH) seasonal rate.
  const expMap = {};
  for (const e of base) expMap[(e.store || "—") + "||" + e.line_label] = e;
  const rateYM = {}, rateMONTH = {};
  for (const rt of monthRates) {
    const k = (rt.store || "—") + "||" + rt.line_label;
    if (rt.scope === "YM" && rt.period_key === target) rateYM[k] = Number(rt.pct_of_revenue);
    else if (rt.scope === "MONTH" && rt.period_key === mm) rateMONTH[k] = Number(rt.pct_of_revenue);
  }
  const monthRateFor = (k) => (rateYM[k] != null ? rateYM[k] : (rateMONTH[k] != null ? rateMONTH[k] : null));

  // Store revenue per month — drives the variable-cost expectation.
  const storeRevenue = {};
  for (const r of records) {
    if (classifyNominal(r.line_label) !== "REVENUE") continue;
    const store = r.unit || "—";
    (storeRevenue[store] ||= {});
    storeRevenue[store][r.ym] = (storeRevenue[store][r.ym] || 0) + Number(r.value || 0);
  }

  const series = {};
  for (const r of records) {
    const store = r.unit || "—";
    const k = store + "||" + r.line_label;
    (series[k] ||= { store, nominal: r.line_label, kind: classifyNominal(r.line_label), m: {} });
    series[k].m[r.ym] = (series[k].m[r.ym] || 0) + Number(r.value || 0);
  }

  const lines = [];
  const revItems = [];
  const basisCounts = { MODEL: 0, RUN_RATE: 0 };
  let runRateCost = 0, targetCost = 0;
  for (const s of Object.values(series)) {
    const posted = s.m[target] || 0;
    if (s.kind === "REVENUE") {
      const present = priorMonths.filter((m) => s.m[m] != null);
      const runRate = present.length ? present.reduce((t, m) => t + s.m[m], 0) / present.length : 0;
      if (runRate > materiality && posted === 0) revItems.push({ store: s.store, nominal: s.nominal, runRate: round0(runRate) });
      continue;
    }
    if (s.kind === "BELOW") continue; // D&A / finance — not accrued here

    const k = s.store + "||" + s.nominal;
    const exp = expMap[k];
    let expected, basis, monthsUsed;
    if (exp) {
      basis = "MODEL";
      expected = expectedForMonth(exp, storeRevenue[s.store]?.[target] || 0, { ym: target, monthRate: monthRateFor(k) });
      monthsUsed = 0;
    } else {
      const present = priorMonths.filter((m) => s.m[m] != null);
      if (!present.length) continue; // no model and no history — nothing to compare
      basis = "RUN_RATE";
      expected = present.reduce((t, m) => t + s.m[m], 0) / present.length;
      monthsUsed = present.length;
    }
    runRateCost += expected; targetCost += posted;
    const gap = expected - posted; // +ve ⇒ under-posted ⇒ accrue
    if (gap >= materiality) {
      basisCounts[basis]++;
      const type = posted === 0 ? "COMPLETENESS" : (posted < 0 ? "REVERSAL" : "DRIFT");
      lines.push({ store: s.store, nominal: s.nominal, kind: s.kind, type, basis, expected: round0(expected), runRate: round0(expected), posted: round0(posted), accrual: round0(gap), monthsUsed });
    }
  }
  lines.sort((a, b) => b.accrual - a.accrual);

  const byType = ACCRUAL_TYPES.map((t) => {
    const ls = lines.filter((l) => l.type === t.code);
    return { code: t.code, label: t.label, tone: t.tone, gap: ls.reduce((s, l) => s + l.accrual, 0), n: ls.length };
  }).filter((t) => t.n > 0);

  const agg = (key) => {
    const m = {};
    for (const l of lines) { (m[l[key]] ||= { key: l[key], gap: 0, n: 0 }); m[l[key]].gap += l.accrual; m[l[key]].n++; }
    return Object.values(m).sort((a, b) => b.gap - a.gap);
  };

  return {
    ready: true, target, months: monthsAll, priorMonths, materiality,
    totals: {
      runRateCost: round0(runRateCost), targetCost: round0(targetCost),
      totalAccrual: round0(lines.reduce((t, l) => t + l.accrual, 0)), flagged: lines.length,
    },
    byType, byNominal: agg("nominal"), byStore: agg("store"), lines,
    revenueMissing: { count: revItems.length, runRate: round0(revItems.reduce((t, x) => t + x.runRate, 0)), items: revItems },
    basisCounts, modelLoaded: modelCount > 0,
  };
}
