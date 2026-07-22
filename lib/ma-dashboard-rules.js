/*
 * Management Accounts dashboard — pure workings (no DB). Actuals come from the
 * per-entity P&L (finance.joiin_pl_entity — the same feed behind Perform →
 * Management Accounts); the DB layer aggregates each scope's sections into
 * { revenue, ebitda } per month and hands them here. We compare that to the
 * forecast (computeForecast) per scope (Store / Head Office / Franchise) and as
 * a summed Group, for a period (current month or year to date). Kept
 * import-free so it's unit-testable.
 */

export const SCOPE_MAP = [
  { scope: "store", forecast: "STORES", label: "Store" },
  { scope: "head_office", forecast: "HEAD_OFFICE", label: "Head Office" },
  { scope: "franchise", forecast: "FRANCHISE", label: "Franchise" },
];

// Accounts reported below EBITDA in the board pack — excluded when aggregating
// so the per-entity EBITDA is on the same basis as the forecast (operating,
// before depreciation, interest and other finance/exceptional items).
export const BELOW_EBITDA = /deprecia|amorti|interest|bank facility|bank charge|finance charge|revaluation/i;

// Operating EBITDA from a month's section sums (costs held positive).
export function ebitda({ revenue = 0, cogs = 0, expenses = 0, otherIncome = 0, otherExpenses = 0 }) {
  return revenue - cogs - expenses + otherIncome - otherExpenses;
}

// Variance of an actual against forecast. favourHigh: higher actual is good.
export function variance(actual, forecast, favourHigh = true) {
  const a = actual == null ? null : Number(actual);
  const f = forecast == null ? null : Number(forecast);
  const delta = a == null || f == null ? null : a - f;
  const pct = delta == null || !f ? null : delta / Math.abs(f);
  const fav = delta == null ? null : favourHigh ? delta >= 0 : delta <= 0;
  return { actual: a, forecast: f, delta, pct, fav };
}

const sumOver = (byMonth, months, key) => months.reduce((t, m) => t + (byMonth?.[m]?.[key] || 0), 0);
const shiftYear = (ym, delta) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || "");
  return m ? `${Number(m[1]) + delta}-${m[2]}` : ym;
};

// The comparison bases the dashboard can measure actuals against.
export const COMPARE_BASES = ["forecast", "budget", "priorYear"];

// actualByScope: { [scope]: { months:[], years:[], byMonth:{ ym: { revenue, ebitda } } } }
// forecast: computeForecast() result | null. period: "current" | "ytd".
// opts: { budget, compare }. budget is a computeForecast()-shaped snapshot (from
// an approved budget version) or null; compare selects which basis drives the
// headline variance ("forecast" | "budget" | "priorYear"). Prior-year actuals
// are derived from actualByScope itself, shifted a year — no extra feed needed.
// The default (no opts, compare="forecast") reproduces the original behaviour
// exactly, so existing callers are unaffected.
export function assembleDashboard(actualByScope, forecast, period = "current", year = null, opts = {}) {
  const budget = opts.budget || null;
  const compare = COMPARE_BASES.includes(opts.compare) ? opts.compare : "forecast";

  const monthSet = new Set(), yearSet = new Set();
  for (const def of SCOPE_MAP) {
    const a = actualByScope[def.scope];
    (a?.months || []).forEach((m) => monthSet.add(m));
    (a?.years || []).forEach((y) => yearSet.add(y));
  }
  const allMonths = [...monthSet].sort();
  const years = [...yearSet].sort();
  const yr = year && years.includes(year) ? year : years[years.length - 1];
  const yrMonths = allMonths.filter((m) => m.startsWith(yr || ""));
  const periodMonths = period === "ytd" ? yrMonths : yrMonths.slice(-1);
  const priorMonths = periodMonths.map((m) => shiftYear(m, -1));

  const scopeRow = (def) => {
    const a = actualByScope[def.scope];
    const fc = forecast?.byScope?.[def.forecast];
    const bg = budget?.byScope?.[def.forecast];
    const hasFc = !!fc && periodMonths.some((m) => fc.months?.[m]);
    const hasBg = !!bg && periodMonths.some((m) => bg.months?.[m]);
    const hasPy = !!a && priorMonths.some((m) => a.byMonth?.[m]);

    const aRev = sumOver(a?.byMonth, periodMonths, "revenue");
    const aEb = sumOver(a?.byMonth, periodMonths, "ebitda");
    const fcMonths = (o, k) => periodMonths.reduce((t, m) => t + (o?.months?.[m]?.[k] || 0), 0);

    const revenueBases = {
      forecast: hasFc ? fcMonths(fc, "sales") : null,
      budget: hasBg ? fcMonths(bg, "sales") : null,
      priorYear: hasPy ? sumOver(a?.byMonth, priorMonths, "revenue") : null,
    };
    const ebitdaBases = {
      forecast: hasFc ? fcMonths(fc, "ebitda") : null,
      budget: hasBg ? fcMonths(bg, "ebitda") : null,
      priorYear: hasPy ? sumOver(a?.byMonth, priorMonths, "ebitda") : null,
    };
    const marginOf = (rev, eb) => (rev ? eb / rev : null);
    return {
      label: def.label,
      revenue: variance(aRev, revenueBases[compare]),
      ebitda: variance(aEb, ebitdaBases[compare]),
      revenueBases,
      ebitdaBases,
      margin: {
        actual: marginOf(aRev, aEb),
        forecast: hasFc ? marginOf(revenueBases.forecast, ebitdaBases.forecast) : null,
        budget: hasBg ? marginOf(revenueBases.budget, ebitdaBases.budget) : null,
        priorYear: hasPy ? marginOf(revenueBases.priorYear, ebitdaBases.priorYear) : null,
      },
    };
  };
  const scopes = SCOPE_MAP.map(scopeRow);

  const sum = (pick) => scopes.reduce((t, s) => { const v = pick(s); return v == null ? t : t + v; }, 0);
  const groupBase = (metric, basis) => {
    const vals = scopes.map((s) => s[`${metric}Bases`][basis]);
    return vals.every((v) => v == null) ? null : vals.reduce((t, v) => t + (v || 0), 0);
  };
  const gRevA = sum((s) => s.revenue.actual);
  const gEbA = sum((s) => s.ebitda.actual);
  const gRevBases = { forecast: groupBase("revenue", "forecast"), budget: groupBase("revenue", "budget"), priorYear: groupBase("revenue", "priorYear") };
  const gEbBases = { forecast: groupBase("ebitda", "forecast"), budget: groupBase("ebitda", "budget"), priorYear: groupBase("ebitda", "priorYear") };
  const group = {
    label: "Group",
    revenue: variance(gRevA, gRevBases[compare]),
    ebitda: variance(gEbA, gEbBases[compare]),
    revenueBases: gRevBases,
    ebitdaBases: gEbBases,
    margin: {
      actual: gRevA ? gEbA / gRevA : null,
      forecast: gRevBases.forecast ? gEbBases.forecast / gRevBases.forecast : null,
      budget: gRevBases.budget ? gEbBases.budget / gRevBases.budget : null,
      priorYear: gRevBases.priorYear ? gEbBases.priorYear / gRevBases.priorYear : null,
    },
  };

  const trend = yrMonths.map((m) => {
    const py = shiftYear(m, -1);
    return {
      ym: m,
      actual: SCOPE_MAP.reduce((t, d) => t + (actualByScope[d.scope]?.byMonth?.[m]?.ebitda || 0), 0),
      forecast: SCOPE_MAP.reduce((t, d) => t + (forecast?.byScope?.[d.forecast]?.months?.[m]?.ebitda || 0), 0),
      budget: budget ? SCOPE_MAP.reduce((t, d) => t + (budget?.byScope?.[d.forecast]?.months?.[m]?.ebitda || 0), 0) : null,
      priorYear: SCOPE_MAP.reduce((t, d) => t + (actualByScope[d.scope]?.byMonth?.[py]?.ebitda || 0), 0),
    };
  });

  return { period, year: yr, years, months: periodMonths, allMonths: yrMonths, compare, scopes, group, trend };
}
