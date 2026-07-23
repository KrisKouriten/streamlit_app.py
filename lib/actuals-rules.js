/*
 * Management-accounts actuals — pure helpers.
 *  - parseActualsWorkbook: reads the long "P&L Actuals (Stores)" tab
 *    (Entity · Store · Month · Nominal · Value) into store × nominal × month
 *    records.
 *  - computeMgmtAccounts: blends actuals with the forecast/budget — actuals take
 *    precedence for any month they cover, the forecast carries forward months,
 *    and the (frozen) forecast is the budget comparative. Emits a P&L (revenue,
 *    operating costs, EBITDA) for Budget / Actual / Current(blended).
 */

import { computeNominalPnl } from "./forecast-rules.js";

const isDate = (v) => v instanceof Date && !isNaN(v);
const ymOf = (v) => {
  if (isDate(v)) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})/) || s.match(/^(\d{1,2})[/](\d{4})$/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${String(m[2]).padStart(2, "0")}` : `${m[2]}-${String(m[1]).padStart(2, "0")}`;
};

// Classify a nominal for the P&L: revenue, below-EBITDA (D&A / finance), else cost.
const RE_REVENUE = /\b(sales|revenue|royalt|franchise fee)\b/i;
const RE_BELOW = /(depreciation|amortis|interest|bank charge|paypal)/i;
export function classifyNominal(label) {
  if (RE_REVENUE.test(label)) return "REVENUE";
  if (RE_BELOW.test(label)) return "BELOW";
  return "COST";
}

export function parseActualsWorkbook(wb) {
  const util = wb._utils;
  const warnings = [];
  // Prefer the long/tidy tab (has Nominal + Value + Month columns).
  let sheetName = null, header = null, rows = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const r = util.sheet_to_json(ws, { header: 1, raw: true });
    const hi = r.findIndex((row) => row && row.map((c) => String(c).trim().toLowerCase())
      .some((c) => c === "nominals" || c === "nominal") && row.map((c) => String(c).trim().toLowerCase()).some((c) => c === "value"));
    if (hi >= 0) { sheetName = name; header = r[hi].map((c) => String(c).trim().toLowerCase()); rows = r.slice(hi + 1); break; }
  }
  if (!rows) { warnings.push("No actuals tab found (needs Nominal, Month and Value columns)"); return { records: [], warnings, months: [] }; }

  const col = (...names) => header.findIndex((h) => names.includes(h));
  const cEntity = col("entity"), cStore = col("store", "location", "unit"),
    cMonth = col("month", "period", "date"), cNom = col("nominals", "nominal", "account"),
    cVal = col("value", "amount");
  if (cNom < 0 || cVal < 0 || cMonth < 0) { warnings.push(`Actuals tab "${sheetName}" missing Nominal/Month/Value`); return { records: [], warnings, months: [] }; }

  const out = [];
  const monthsSet = new Set();
  for (const r of rows) {
    if (!r) continue;
    const nominal = cNom >= 0 && r[cNom] != null ? String(r[cNom]).trim() : "";
    const v = r[cVal];
    if (!nominal || typeof v !== "number") continue;
    const ym = ymOf(r[cMonth]);
    if (!ym) continue;
    const store = cStore >= 0 && r[cStore] != null ? String(r[cStore]).trim() : null;
    const entity = cEntity >= 0 && r[cEntity] != null ? String(r[cEntity]).trim() : null;
    out.push({ scope: "STORES", entity: entity || null, unit: store || null, line_label: nominal, ym, value: v });
    monthsSet.add(ym);
  }
  return { records: out, warnings, months: [...monthsSet].sort(), sheet: sheetName };
}

// forecastLines: finance.forecast_line rows; actualRecords: mgmt_actual rows.
export function computeMgmtAccounts(forecastLines, actualRecords, { scope = "STORES", unit = null } = {}) {
  const budget = computeNominalPnl(forecastLines, { scope, unit }); // per-nominal monthly £ (rates × sales etc.)

  const actual = {}; // line_label -> { ym: £ }
  const actualMonthsSet = new Set();
  for (const a of actualRecords) {
    if (scope && a.scope && a.scope !== scope) continue;
    if (unit != null && (a.unit || null) !== unit) continue;
    (actual[a.line_label] ||= {});
    actual[a.line_label][a.ym] = (actual[a.line_label][a.ym] || 0) + Number(a.value);
    actualMonthsSet.add(a.ym);
  }

  const months = [...new Set([...budget.months, ...actualMonthsSet])].sort();
  const actualMonths = [...actualMonthsSet].sort();
  const isActual = (ym) => actualMonthsSet.has(ym);

  const bLine = {}; for (const r of budget.rows) bLine[r.line_label] = r;
  const labels = [...new Set([...budget.rows.map((r) => r.line_label), ...Object.keys(actual)])];

  const order = { REVENUE: 0, COST: 1, BELOW: 2 };
  const rows = labels.map((label) => {
    const kind = classifyNominal(label);
    const bM = bLine[label]?.months || {};
    const aM = actual[label] || {};
    const cM = {};
    for (const m of months) cM[m] = isActual(m) ? (aM[m] || 0) : (bM[m] || 0);
    const total = (mm) => months.reduce((t, m) => t + (mm[m] || 0), 0);
    return { line_label: label, kind, budget: bM, actual: aM, current: cM, budgetTotal: total(bM), actualTotal: total(aM), currentTotal: total(cM) };
  }).filter((r) => r.budgetTotal !== 0 || r.actualTotal !== 0 || Object.keys(r.actual).length)
    .sort((a, b) => order[a.kind] - order[b.kind] || b.currentTotal - a.currentTotal);

  // Series totals: revenue − operating cost = EBITDA (BELOW excluded from EBITDA).
  const mkTotals = (pick) => {
    const rev = {}, cost = {}, below = {}, ebitda = {}, net = {};
    for (const m of months) { rev[m] = 0; cost[m] = 0; below[m] = 0; }
    for (const r of rows) {
      const src = r[pick];
      for (const m of months) {
        const v = src[m] || 0;
        if (r.kind === "REVENUE") rev[m] += v; else if (r.kind === "BELOW") below[m] += v; else cost[m] += v;
      }
    }
    for (const m of months) { ebitda[m] = rev[m] - cost[m]; net[m] = ebitda[m] - below[m]; }
    const sum = (mm) => months.reduce((t, m) => t + (mm[m] || 0), 0);
    return { revenue: { months: rev, total: sum(rev) }, cost: { months: cost, total: sum(cost) }, below: { months: below, total: sum(below) }, ebitda: { months: ebitda, total: sum(ebitda) }, net: { months: net, total: sum(net) } };
  };

  return {
    scope, unit, months, actualMonths, isActualMonth: Object.fromEntries(months.map((m) => [m, isActual(m)])),
    rows,
    totals: { budget: mkTotals("budget"), actual: mkTotals("actual"), current: mkTotals("current") },
  };
}
