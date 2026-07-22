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

// actualByScope: { [scope]: { months:[], years:[], byMonth:{ ym: { revenue, ebitda } } } }
// forecast: computeForecast() result | null. period: "current" | "ytd".
export function assembleDashboard(actualByScope, forecast, period = "current", year = null) {
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

  const scopeRow = (def) => {
    const a = actualByScope[def.scope];
    const fc = forecast?.byScope?.[def.forecast];
    const hasFc = !!fc && periodMonths.some((m) => fc.months?.[m]);
    const aRev = sumOver(a?.byMonth, periodMonths, "revenue");
    const aEb = sumOver(a?.byMonth, periodMonths, "ebitda");
    const fRev = periodMonths.reduce((t, m) => t + (fc?.months?.[m]?.sales || 0), 0);
    const fEb = periodMonths.reduce((t, m) => t + (fc?.months?.[m]?.ebitda || 0), 0);
    return {
      label: def.label,
      revenue: variance(aRev, hasFc ? fRev : null),
      ebitda: variance(aEb, hasFc ? fEb : null),
      margin: { actual: aRev ? aEb / aRev : null, forecast: hasFc && fRev ? fEb / fRev : null },
    };
  };
  const scopes = SCOPE_MAP.map(scopeRow);

  const sum = (pick) => scopes.reduce((t, s) => { const v = pick(s); return v == null ? t : t + v; }, 0);
  const gRevA = sum((s) => s.revenue.actual), gRevF = sum((s) => s.revenue.forecast);
  const gEbA = sum((s) => s.ebitda.actual), gEbF = sum((s) => s.ebitda.forecast);
  const group = {
    label: "Group",
    revenue: variance(gRevA, gRevF),
    ebitda: variance(gEbA, gEbF),
    margin: { actual: gRevA ? gEbA / gRevA : null, forecast: gRevF ? gEbF / gRevF : null },
  };

  const trend = yrMonths.map((m) => ({
    ym: m,
    actual: SCOPE_MAP.reduce((t, d) => t + (actualByScope[d.scope]?.byMonth?.[m]?.ebitda || 0), 0),
    forecast: SCOPE_MAP.reduce((t, d) => t + (forecast?.byScope?.[d.forecast]?.months?.[m]?.ebitda || 0), 0),
  }));

  return { period, year: yr, years, months: periodMonths, allMonths: yrMonths, scopes, group, trend };
}
