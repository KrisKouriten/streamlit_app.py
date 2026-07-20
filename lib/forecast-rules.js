/*
 * Forecast workings — pure, unit-testable. Computes the monthly P&L for each
 * scope from the Operate forecast inputs, with scenario levers applied:
 *   sales (SALES £)            × (1 + sales_pct)
 *   variable (rate × sales)    rate × (1 + variable_pct)
 *   fixed (FIXED £)            × (1 + fixed_pct)
 * STORES: variable lines are driven by each store's own sales. HEAD_OFFICE and
 * FRANCHISE lines are modelled amounts (SALES = revenue lines, FIXED = costs).
 */

export const SCOPES = {
  STORES: "Company stores",
  HEAD_OFFICE: "Head office",
  FRANCHISE: "Franchise",
};

const BASE = { sales_pct: 0, variable_pct: 0, fixed_pct: 0 };

// lines: [{scope, unit, line_label, cost_type, ym, value}]
// Returns { months: [ym...], byScope: {scope: {months: {ym: {sales, variable, fixed, ebitda}}, totals}}, group }
export function computeForecast(lines, scenario = BASE) {
  const s = { ...BASE, ...(scenario || {}) };
  const months = [...new Set(lines.filter((l) => l.ym).map((l) => l.ym))].sort();
  const byScope = {};

  for (const scope of Object.keys(SCOPES)) {
    const mine = lines.filter((l) => l.scope === scope);
    const perMonth = {};
    for (const ym of months) perMonth[ym] = { sales: 0, variable: 0, fixed: 0, ebitda: 0 };

    // sales by unit-month (drives variable rates for STORES)
    const salesByUnit = {};
    for (const l of mine) {
      if (l.cost_type !== "SALES" || !l.ym || !(l.ym in perMonth)) continue;
      const v = Number(l.value) * (1 + s.sales_pct);
      perMonth[l.ym].sales += v;
      const u = l.unit || "";
      (salesByUnit[u] ||= {})[l.ym] = ((salesByUnit[u] || {})[l.ym] || 0) + v;
    }
    for (const l of mine) {
      if (l.cost_type === "FIXED" && l.ym && l.ym in perMonth) {
        perMonth[l.ym].fixed += Number(l.value) * (1 + s.fixed_pct);
      }
    }
    for (const l of mine) {
      if (l.cost_type !== "VARIABLE_RATE") continue;
      const rate = Number(l.value) * (1 + s.variable_pct);
      const unitSales = salesByUnit[l.unit || ""] || {};
      for (const ym of Object.keys(unitSales)) {
        if (ym in perMonth) perMonth[ym].variable += rate * unitSales[ym];
      }
    }
    for (const ym of months) {
      const m = perMonth[ym];
      m.ebitda = m.sales - m.variable - m.fixed;
    }
    const totals = { sales: 0, variable: 0, fixed: 0, ebitda: 0 };
    for (const ym of months) for (const k of Object.keys(totals)) totals[k] += perMonth[ym][k];
    byScope[scope] = { months: perMonth, totals };
  }

  const group = { months: {}, totals: { sales: 0, variable: 0, fixed: 0, ebitda: 0 } };
  for (const ym of months) {
    group.months[ym] = { sales: 0, variable: 0, fixed: 0, ebitda: 0 };
    for (const scope of Object.keys(SCOPES)) {
      const m = byScope[scope].months[ym];
      for (const k of Object.keys(group.months[ym])) group.months[ym][k] += m[k];
    }
  }
  for (const scope of Object.keys(SCOPES)) {
    for (const k of Object.keys(group.totals)) group.totals[k] += byScope[scope].totals[k];
  }
  return { months, byScope, group, scenario: s };
}

// --- CSV upload: scope,unit,line_label,cost_type,ym,value -------------------
import { parseCsv } from "./intercompany-rules.js";

export const FORECAST_CSV_TEMPLATE = "Scope,Unit,Line,Cost Type,Month,Value";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[£$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseForecastCsv(text) {
  const { headers, records } = parseCsv(text);
  const h = headers.map((x) => x.toLowerCase().trim());
  const col = (frag) => { const i = h.findIndex((x) => x.includes(frag)); return i < 0 ? null : headers[i]; };
  const cScope = col("scope"), cUnit = col("unit") || col("store"), cLine = col("line"),
    cType = col("cost type") || col("type"), cYm = col("month") || col("ym"), cVal = col("value") || col("amount");
  const out = [], errors = [];
  records.forEach((r, idx) => {
    const scope = String(r[cScope] || "").trim().toUpperCase().replace(/\s+/g, "_");
    const cost_type = String(r[cType] || "").trim().toUpperCase().replace(/\s+/g, "_");
    const line_label = cLine ? String(r[cLine] || "").trim() : "";
    const ymRaw = cYm ? String(r[cYm] || "").trim() : "";
    const value = num(r[cVal]);
    if (!Object.keys(SCOPES).includes(scope)) { errors.push({ row: idx + 2, reason: "scope must be STORES, HEAD_OFFICE or FRANCHISE" }); return; }
    if (!["SALES", "VARIABLE_RATE", "FIXED"].includes(cost_type)) { errors.push({ row: idx + 2, reason: "cost type must be SALES, VARIABLE_RATE or FIXED" }); return; }
    if (!line_label) { errors.push({ row: idx + 2, reason: "missing line" }); return; }
    if (value == null) { errors.push({ row: idx + 2, reason: "missing value" }); return; }
    let ym = null;
    if (ymRaw) {
      const m = ymRaw.match(/^(\d{4})[-\/](\d{1,2})/) || ymRaw.match(/^(\d{1,2})[\/](\d{4})$/);
      if (m) ym = m[1].length === 4 ? `${m[1]}-${String(m[2]).padStart(2, "0")}` : `${m[2]}-${String(m[1]).padStart(2, "0")}`;
      else { errors.push({ row: idx + 2, reason: `unreadable month "${ymRaw}" (use YYYY-MM)` }); return; }
    }
    if (cost_type !== "VARIABLE_RATE" && !ym) { errors.push({ row: idx + 2, reason: "SALES/FIXED rows need a Month" }); return; }
    out.push({ scope, unit: cUnit ? String(r[cUnit] || "").trim() || null : null, line_label, cost_type, ym, value });
  });
  return { records: out, errors };
}
