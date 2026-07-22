/*
 * Management Accounts dashboard — pure workings (no DB). Extracts the Revenue
 * and EBITDA KPIs from the board-pack rows, matches them to the forecast, and
 * assembles the scope / group comparison and the monthly trend. The DB layer
 * (ma-dashboard.js) fetches the board packs and forecast, then calls
 * assembleDashboard here. Kept import-free so it's unit-testable.
 */

// Board-pack scope → forecast scope, and the row each KPI lives on. Labels are
// the fixed board-pack layout lines (Joiin custom reports); matched exactly.
export const SCOPE_MAP = [
  { scope: "store", forecast: "STORES", label: "Store",
    sales: /^total store sales$/i, ebitda: /^store ebitda$/i },
  { scope: "head_office", forecast: "HEAD_OFFICE", label: "Head Office",
    sales: /^total wholesale sales$/i, ebitda: /^wholesale ebitda$/i },
  { scope: "franchise", forecast: "FRANCHISE", label: "Franchise",
    sales: /^total franchise revenue$/i, ebitda: /^franchise ebitda$/i },
];

// Sum a render-ready board-pack row's values across the given months.
export function sumRow(row, months) {
  if (!row) return null;
  return months.reduce((t, m) => t + (row.values?.[m] || 0), 0);
}

// Find the KPI value on a board pack: the first non-section row matching `re`.
export function kpiFromPack(rows, re, months) {
  const row = (rows || []).find((r) => r.kind !== "section" && re.test(r.label));
  return sumRow(row, months);
}

// Variance of an actual against forecast. `favourHigh` true means higher actual
// is favourable (revenue, EBITDA). Returns { actual, forecast, delta, pct, fav }.
export function variance(actual, forecast, favourHigh = true) {
  const a = actual == null ? null : Number(actual);
  const f = forecast == null ? null : Number(forecast);
  const delta = a == null || f == null ? null : a - f;
  const pct = delta == null || !f ? null : delta / Math.abs(f);
  const fav = delta == null ? null : favourHigh ? delta >= 0 : delta <= 0;
  return { actual: a, forecast: f, delta, pct, fav };
}

function compareScope(packRows, fcScope, def, months) {
  const aSales = kpiFromPack(packRows, def.sales, months);
  const aEbitda = kpiFromPack(packRows, def.ebitda, months);
  const hasFc = !!fcScope && months.some((m) => fcScope.months?.[m]);
  const fSales = months.reduce((t, m) => t + (fcScope?.months?.[m]?.sales || 0), 0);
  const fEbitda = months.reduce((t, m) => t + (fcScope?.months?.[m]?.ebitda || 0), 0);
  return {
    label: def.label,
    revenue: variance(aSales, hasFc ? fSales : null),
    ebitda: variance(aEbitda, hasFc ? fEbitda : null),
    margin: { actual: aSales ? aEbitda / aSales : null, forecast: hasFc && fSales ? fEbitda / fSales : null },
  };
}

// Assemble the dashboard from fetched inputs.
//   packs: { [scope]: { loaded, rows, months, years } }  (getBoardPack results)
//   forecast: computeForecast() result | null
// period: "current" | "ytd". Returns { period, year, years, months, scopes, group, trend }.
export function assembleDashboard(packs, forecast, period = "current", year = null) {
  const monthSet = new Set();
  const yearSet = new Set();
  for (const def of SCOPE_MAP) {
    const p = packs[def.scope];
    if (p?.loaded) { (p.months || []).forEach((m) => monthSet.add(m)); (p.years || []).forEach((y) => yearSet.add(y)); }
  }
  const allMonths = [...monthSet].sort();
  const years = [...yearSet].sort();
  const yr = year && years.includes(year) ? year : years[years.length - 1];
  const periodMonths = period === "ytd" ? allMonths : allMonths.slice(-1);

  const scopes = SCOPE_MAP.map((def) =>
    compareScope(packs[def.scope]?.rows, forecast?.byScope?.[def.forecast], def, periodMonths));

  const sum = (pick) => scopes.reduce((t, s) => { const v = pick(s); return v == null ? t : t + v; }, 0);
  const gSalesA = sum((s) => s.revenue.actual), gSalesF = sum((s) => s.revenue.forecast);
  const gEbitdaA = sum((s) => s.ebitda.actual), gEbitdaF = sum((s) => s.ebitda.forecast);
  const group = {
    label: "Group",
    revenue: variance(gSalesA, gSalesF),
    ebitda: variance(gEbitdaA, gEbitdaF),
    margin: { actual: gSalesA ? gEbitdaA / gSalesA : null, forecast: gSalesF ? gEbitdaF / gSalesF : null },
  };

  const trend = allMonths.map((m) => {
    const actual = SCOPE_MAP.reduce((t, d) => t + (kpiFromPack(packs[d.scope]?.rows, d.ebitda, [m]) || 0), 0);
    const fc = SCOPE_MAP.reduce((t, d) => t + (forecast?.byScope?.[d.forecast]?.months?.[m]?.ebitda || 0), 0);
    return { ym: m, actual, forecast: fc };
  });

  return { period, year: yr, years, months: periodMonths, allMonths, scopes, group, trend };
}
