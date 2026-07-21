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
    // Variable rates: a rate with no month is the constant default ("*"); a
    // month-specific rate (monthly COGS, labour seasonality) overrides it for
    // that month. Applied to each unit's own sales.
    const varRates = {}; // unit -> line -> { "*": rate, "YYYY-MM": rate }
    for (const l of mine) {
      if (l.cost_type !== "VARIABLE_RATE") continue;
      const u = l.unit || "";
      ((varRates[u] ||= {})[l.line_label] ||= {})[l.ym || "*"] = Number(l.value);
    }
    for (const u of Object.keys(varRates)) {
      const unitSales = salesByUnit[u] || {};
      for (const line of Object.keys(varRates[u])) {
        const rmap = varRates[u][line];
        for (const ym of Object.keys(unitSales)) {
          if (!(ym in perMonth)) continue;
          const rate = rmap[ym] ?? rmap["*"];
          if (rate == null) continue;
          perMonth[ym].variable += rate * (1 + s.variable_pct) * unitSales[ym];
        }
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

/*
 * Full nominal P&L — the line-by-line build from sales down to EBITDA, for one
 * scope and (optionally) one unit/store. Sales lines pass through; fixed lines
 * pass through; variable lines become rate × that unit's own sales (a
 * month-specific rate overrides the constant default). With no unit it
 * aggregates every unit in the scope — computed per unit then summed, so each
 * store's own rates apply to its own sales. Zero-only lines are dropped.
 * Returns { scope, unit, months, rows:[{line_label,kind,months,total}], totals }.
 */
export function computeNominalPnl(lines, { scope, unit = null } = {}, scenario = BASE) {
  const s = { ...BASE, ...(scenario || {}) };
  const scopeLines = lines.filter((l) => l.scope === scope);
  const months = [...new Set(scopeLines.filter((l) => l.ym).map((l) => l.ym))].sort();
  const groups = unit != null ? [unit] : [...new Set(scopeLines.map((l) => l.unit || ""))];

  const acc = {}; // line_label -> { line_label, kind, months: {ym: £} }
  const ensure = (label, kind) => (acc[label] ||= { line_label: label, kind, months: {} });
  const add = (o, ym, v) => { o.months[ym] = (o.months[ym] || 0) + v; };

  for (const g of groups) {
    const gl = scopeLines.filter((l) => (l.unit || "") === (g || ""));
    const salesByMonth = {};
    for (const l of gl) {
      if (l.cost_type !== "SALES" || !l.ym) continue;
      salesByMonth[l.ym] = (salesByMonth[l.ym] || 0) + Number(l.value) * (1 + s.sales_pct);
    }
    for (const l of gl) {
      if (l.cost_type === "SALES" && l.ym) add(ensure(l.line_label, "SALES"), l.ym, Number(l.value) * (1 + s.sales_pct));
      else if (l.cost_type === "FIXED" && l.ym) add(ensure(l.line_label, "FIXED"), l.ym, Number(l.value) * (1 + s.fixed_pct));
    }
    const varRates = {}; // line -> { "*": rate, "YYYY-MM": rate }
    for (const l of gl) {
      if (l.cost_type !== "VARIABLE_RATE") continue;
      (varRates[l.line_label] ||= {})[l.ym || "*"] = Number(l.value);
    }
    for (const line of Object.keys(varRates)) {
      const rmap = varRates[line];
      const o = ensure(line, "VARIABLE");
      for (const ym of months) {
        const sales = salesByMonth[ym];
        if (sales == null) continue;
        const rate = rmap[ym] ?? rmap["*"];
        if (rate == null) continue;
        add(o, ym, rate * (1 + s.variable_pct) * sales);
      }
    }
  }

  const order = { SALES: 0, VARIABLE: 1, FIXED: 2 };
  const bucket = { SALES: "sales", VARIABLE: "variable", FIXED: "fixed" };
  const rows = Object.values(acc)
    .map((o) => ({ ...o, total: months.reduce((t, m) => t + (o.months[m] || 0), 0) }))
    .filter((o) => o.total !== 0 || months.some((m) => o.months[m]))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.total - a.total);

  const totals = { sales: mk(), variable: mk(), fixed: mk(), ebitda: mk() };
  function mk() { return { months: {}, total: 0 }; }
  for (const r of rows) for (const m of months) totals[bucket[r.kind]].months[m] = (totals[bucket[r.kind]].months[m] || 0) + (r.months[m] || 0);
  for (const k of ["sales", "variable", "fixed"]) totals[k].total = months.reduce((t, m) => t + (totals[k].months[m] || 0), 0);
  for (const m of months) totals.ebitda.months[m] = (totals.sales.months[m] || 0) - (totals.variable.months[m] || 0) - (totals.fixed.months[m] || 0);
  totals.ebitda.total = totals.sales.total - totals.variable.total - totals.fixed.total;

  return { scope, unit, months, rows, totals };
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

/* -------------------------------------------------------------------------
 * 3-tab store forecast workbook (Sales Forecast · Cost Assumptions ·
 * Labour Seasonality). Emits STORES-scope forecast_line records carrying the
 * store → entity hierarchy, fixed-cost start dates expanded to monthly lines,
 * and month-specific variable rates (seasonal COGS + labour). Pure: takes a
 * SheetJS workbook object so the DB layer owns the file read.
 * ---------------------------------------------------------------------- */

const isDate = (v) => v instanceof Date && !isNaN(v);
const ymOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const rows1 = (wb, name) => {
  const ws = wb.Sheets[name];
  return ws ? wb._utils.sheet_to_json(ws, { header: 1, raw: true }) : null;
};
const findSheet = (wb, ...frags) =>
  wb.SheetNames.find((n) => frags.every((f) => n.toLowerCase().includes(f)));

export function parseForecastWorkbook(wb) {
  const out = [];
  const storeEntity = {};
  const warn = [];

  // --- Sales Forecast: Store Number | Entity | Store | <month dates...> -----
  const salesName = findSheet(wb, "sales") || findSheet(wb, "forecast");
  const salesRows = salesName ? rows1(wb, salesName) : null;
  const forecastYms = new Set();
  if (salesRows) {
    const hi = salesRows.findIndex((r) => r && r.some((c) => typeof c === "string" && c.trim().toLowerCase() === "store")
      && r.some((c) => typeof c === "string" && c.trim().toLowerCase() === "entity"));
    if (hi >= 0) {
      const hdr = salesRows[hi];
      const entCol = hdr.findIndex((c) => String(c).trim().toLowerCase() === "entity");
      const storeCol = hdr.findIndex((c) => String(c).trim().toLowerCase() === "store");
      const monthCols = hdr.map((c, i) => (isDate(c) ? [i, ymOf(c)] : null)).filter(Boolean);
      for (const [, ym] of monthCols) forecastYms.add(ym);
      for (let ri = hi + 1; ri < salesRows.length; ri++) {
        const r = salesRows[ri]; if (!r) continue;
        const store = r[storeCol] && String(r[storeCol]).trim();
        const entity = r[entCol] && String(r[entCol]).trim();
        if (!store) continue;
        if (entity) storeEntity[store] = entity;
        for (const [ci, ym] of monthCols) {
          const v = r[ci];
          if (typeof v === "number" && v !== 0) out.push({ scope: "STORES", unit: store, entity: entity || null, line_label: "ST: Sales", cost_type: "SALES", ym, value: v });
        }
      }
    } else warn.push("Sales Forecast: header row (Entity/Store + month dates) not found");
  } else warn.push("Sales Forecast sheet not found");

  const yms = [...forecastYms].sort();
  const ymsForMonth = (mo) => yms.filter((y) => +y.slice(5, 7) === mo); // spread a month-of-year pattern across the horizon
  const ent = (store) => storeEntity[store] || null;

  // --- Cost Assumptions: stores across columns, blocks down column B --------
  const caName = findSheet(wb, "cost", "assumption") || findSheet(wb, "cost");
  const caRows = caName ? rows1(wb, caName) : null;
  if (caRows) {
    // store columns from the row that holds the store names (has "Cost Assumptions" in col 0/1)
    const hi = caRows.findIndex((r) => r && r.some((c) => typeof c === "string" && c.toLowerCase().includes("cost assumption")));
    const storeCols = [];
    if (hi >= 0) caRows[hi].forEach((c, i) => { if (i >= 2 && typeof c === "string" && c.trim()) storeCols.push([i, c.trim()]); });

    const labelAt = (r) => (r && typeof r[1] === "string" ? r[1].trim() : "");
    let section = null, cogsSubStores = null;
    const startMap = {}; // nominal -> store -> startYm
    for (let ri = 0; ri < caRows.length; ri++) {
      const r = caRows[ri]; const label = labelAt(r);
      if (/^fixed costs.*£/i.test(label)) { section = "FIXED_AMT"; continue; }
      if (/^fixed costs.*start/i.test(label)) { section = "FIXED_START"; continue; }
      if (/^variable costs/i.test(label)) { section = "VAR"; continue; }
      if (/^monthly cost of goods/i.test(label)) { section = "COGS_M"; cogsSubStores = null; continue; }
      if (!section) continue;
      // COGS_M month rows hold the month as a date in col 1 (no text label), so
      // they must not be filtered out by the empty-label guard below.
      if (!label && !(section === "COGS_M" && isDate(r?.[1]))) continue;

      if (section === "FIXED_AMT") {
        for (const [ci, store] of storeCols) {
          const v = r[ci];
          if (typeof v === "number" && v !== 0) {
            const start = startMap[label]?.[store];
            const from = start || (yms[0] || null);
            for (const ym of yms) if (!from || ym >= from) out.push({ scope: "STORES", unit: store, entity: ent(store), line_label: label, cost_type: "FIXED", ym, value: v });
          }
        }
      } else if (section === "FIXED_START") {
        for (const [ci, store] of storeCols) {
          const v = r[ci];
          if (isDate(v)) ((startMap[label] ||= {})[store] = ymOf(v));
        }
        // start dates may appear after amounts; re-expand handled below
      } else if (section === "VAR") {
        for (const [ci, store] of storeCols) {
          const v = r[ci];
          if (typeof v === "number") out.push({ scope: "STORES", unit: store, entity: ent(store), line_label: label, cost_type: "VARIABLE_RATE", ym: null, value: v });
        }
      } else if (section === "COGS_M") {
        // sub-header row "Month | store | store..." then explicit dated month
        // rows — each carries its own real month (e.g. 2026-01-31), so map to
        // that exact ym; keep only months in the sales horizon (all, if sales
        // absent) so a cost-only workbook still loads its rates.
        if (String(label).toLowerCase() === "month") { cogsSubStores = []; caRows[ri].forEach((c, i) => { if (i >= 2 && typeof c === "string" && c.trim()) cogsSubStores.push([i, c.trim()]); }); continue; }
        const mcell = r[1];
        if (isDate(mcell) && cogsSubStores) {
          const ym = ymOf(mcell);
          if (!yms.length || yms.includes(ym)) {
            for (const [ci, store] of cogsSubStores) {
              const v = r[ci];
              if (typeof v === "number") out.push({ scope: "STORES", unit: store, entity: ent(store), line_label: "ST: Cost of Goods Sold", cost_type: "VARIABLE_RATE", ym, value: v });
            }
          }
        }
      }
    }
    // Start dates parsed after amounts: rebuild FIXED lines honouring starts.
    if (Object.keys(startMap).length) {
      const fixedIdx = [];
      out.forEach((o, i) => { if (o.cost_type === "FIXED" && startMap[o.line_label]?.[o.unit]) fixedIdx.push(i); });
      const drop = new Set();
      for (const i of fixedIdx) { const o = out[i]; if (o.ym < startMap[o.line_label][o.unit]) drop.add(i); }
      if (drop.size) { const kept = out.filter((_, i) => !drop.has(i)); out.length = 0; out.push(...kept); }
    }
  } else warn.push("Cost Assumptions sheet not found");

  // --- Labour Seasonality: store rows, Jan..Dec monthly labour % of sales ---
  const lsName = findSheet(wb, "labour") || findSheet(wb, "seasonal");
  const lsRows = lsName ? rows1(wb, lsName) : null;
  if (lsRows) {
    const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const hi = lsRows.findIndex((r) => r && r.map((c) => String(c).trim().toLowerCase()).filter((x) => MONTHS.includes(x)).length >= 6);
    if (hi >= 0) {
      const hdr = lsRows[hi].map((c) => String(c).trim().toLowerCase());
      const monthCols = hdr.map((c, i) => (MONTHS.includes(c) ? [i, MONTHS.indexOf(c) + 1] : null)).filter(Boolean);
      const lineLabel = "ST: Salaries - Basic Pay";
      for (let ri = hi + 1; ri < lsRows.length; ri++) {
        const r = lsRows[ri]; if (!r) continue;
        const store = r[1] && String(r[1]).trim();
        if (!store || !storeEntity[store]) continue; // only real stores
        for (const [ci, mo] of monthCols) {
          const v = r[ci];
          if (typeof v === "number") for (const ym of ymsForMonth(mo)) out.push({ scope: "STORES", unit: store, entity: ent(store), line_label: lineLabel, cost_type: "VARIABLE_RATE", ym, value: v });
        }
      }
    }
  }

  return { records: out, storeEntity, warnings: warn, months: yms };
}

