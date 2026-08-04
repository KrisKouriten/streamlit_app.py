/*
 * Store cost model — pure helpers for the "Fixed, Variable and Labour Costs"
 * workbook. Produces the per-store expectation the accrual review compares to
 * actuals:
 *   - base records: FIXED (£/month, with an optional start month) or VARIABLE
 *     (a flat % of that store's sales).
 *   - month rates: variable rates that vary by month — the monthly COGS %
 *     override (an absolute YYYY-MM) and the seasonal labour chain (a calendar
 *     month 01..12 that repeats each year).
 * parseCostModelWorkbook reads the wide "Cost Assumptions" + "Labour
 * Seasonality" layout; it falls back to a simple long tab (Store · Nominal ·
 * Behaviour · Monthly Amount · % of Revenue). Unit-tested in
 * tests/cost-model-rules.test.mjs.
 */

// Normalise a behaviour cell to FIXED / VARIABLE (null if neither).
export function classifyBehaviour(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("fix") || s === "f") return "FIXED";
  if (s.startsWith("var") || s === "v") return "VARIABLE";
  return null;
}

// A revenue rate may arrive as a fraction (0.4) or a percentage (40) — normalise
// to a fraction. Anything > 1.5 is read as a percentage.
export function normaliseRate(v) {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return null;
  return Math.abs(n) > 1.5 ? n / 100 : n;
}

const isDate = (v) => v instanceof Date && !isNaN(v);
const ymOfDate = (v) => {
  let d = null;
  if (isDate(v)) d = v;
  else if (typeof v === "number" && v > 1000) d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); // Excel serial
  return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null;
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/*
 * The expected £ for one month.
 *  - FIXED: the monthly amount, but only from its start month onward.
 *  - VARIABLE: (month-specific rate, else the flat rate) × revenue.
 * opts.ym is 'YYYY-MM'; opts.monthRate is the resolved month-varying rate (or null).
 */
export function expectedForMonth(exp, revenue = 0, { ym = null, monthRate = null } = {}) {
  if (!exp) return 0;
  if (exp.behaviour === "FIXED") {
    if (exp.start_ym && ym && ym < exp.start_ym) return 0;
    return Number(exp.monthly_amount) || 0;
  }
  if (exp.behaviour === "VARIABLE") {
    const rate = monthRate != null ? monthRate : exp.pct_of_revenue;
    return (Number(rate) || 0) * (Number(revenue) || 0);
  }
  return 0;
}

// Section markers on the Cost Assumptions tab.
const isMarker = (cell, re) => typeof cell === "string" && re.test(cell);

function parseWide(wb, warnings) {
  const util = wb._utils;
  const records = [];      // base expectations
  const monthRates = [];   // { store, line_label, scope, period_key, pct_of_revenue }
  const storesSet = new Set();

  const ca = wb.Sheets["Cost Assumptions"];
  if (ca) {
    const r = util.sheet_to_json(ca, { header: 1, raw: true });
    const storeCols = (r[0] || []).map((v, i) => ({ i, name: String(v ?? "").trim() })).filter((c) => c.i >= 2 && c.name);
    for (const c of storeCols) storesSet.add(c.name);

    // Locate the section marker rows.
    let iFixed = -1, iStart = -1, iVar = -1, iCogsHdr = -1;
    for (let i = 0; i < r.length; i++) {
      const c1 = r[i] && r[i][1];
      if (isMarker(c1, /^FIXED COSTS\b.*month/i)) iFixed = i;
      else if (isMarker(c1, /^FIXED COSTS\b.*Start Date/i)) iStart = i;
      else if (isMarker(c1, /^VARIABLE COSTS\b/i)) iVar = i;
      else if (isMarker(c1, /^MONTHLY COST OF GOODS SOLD/i)) iCogsHdr = i;
    }

    const sectionEnd = (start, ...next) => {
      const ends = next.filter((n) => n > start).sort((a, b) => a - b);
      return ends.length ? ends[0] : r.length;
    };

    const baseMap = {}; // store||nominal -> record (so start dates merge in)
    // FIXED £/month
    if (iFixed >= 0) {
      const end = sectionEnd(iFixed, iStart, iVar, iCogsHdr);
      for (let i = iFixed + 1; i < end; i++) {
        const nominal = r[i] && r[i][1] != null ? String(r[i][1]).trim() : "";
        if (!nominal) continue;
        for (const c of storeCols) {
          const v = r[i][c.i];
          if (typeof v !== "number" || !isFinite(v)) continue;
          const k = c.name + "||" + nominal;
          baseMap[k] = { store: c.name, line_label: nominal, behaviour: "FIXED", monthly_amount: v, pct_of_revenue: null, start_ym: null };
        }
      }
    }
    // FIXED start dates
    if (iStart >= 0) {
      const end = sectionEnd(iStart, iVar, iCogsHdr);
      for (let i = iStart + 1; i < end; i++) {
        const nominal = r[i] && r[i][1] != null ? String(r[i][1]).trim() : "";
        if (!nominal) continue;
        for (const c of storeCols) {
          const ym = ymOfDate(r[i][c.i]);
          if (!ym) continue;
          const rec = baseMap[c.name + "||" + nominal];
          if (rec) rec.start_ym = ym;
        }
      }
    }
    // VARIABLE flat % of sales
    if (iVar >= 0) {
      const end = sectionEnd(iVar, iCogsHdr);
      for (let i = iVar + 1; i < end; i++) {
        const nominal = r[i] && r[i][1] != null ? String(r[i][1]).trim() : "";
        if (!nominal) continue;
        for (const c of storeCols) {
          const v = r[i][c.i];
          if (typeof v !== "number" || !isFinite(v)) continue;
          baseMap[c.name + "||" + nominal] = { store: c.name, line_label: nominal, behaviour: "VARIABLE", monthly_amount: null, pct_of_revenue: v, start_ym: null };
        }
      }
    }
    records.push(...Object.values(baseMap));

    // Monthly COGS % override — store × month grid under a "Month" header row.
    if (iCogsHdr >= 0) {
      const hdr = r[iCogsHdr + 1] || [];
      const cols = hdr.map((v, i) => ({ i, name: String(v ?? "").trim() })).filter((c) => c.i >= 2 && c.name);
      for (let i = iCogsHdr + 2; i < r.length; i++) {
        const ym = ymOfDate(r[i] && r[i][1]);
        if (!ym) continue;
        for (const c of cols) {
          const v = r[i][c.i];
          if (typeof v !== "number" || !isFinite(v)) continue;
          monthRates.push({ store: c.name, line_label: "ST: Cost of Goods Sold", scope: "YM", period_key: ym, pct_of_revenue: v });
        }
      }
    }
  } else {
    warnings.push('No "Cost Assumptions" tab — fixed / variable costs not loaded');
  }

  // Labour Seasonality — four blocks forming the labour chain, each store × 12
  // calendar months. Fold the chain into an effective % of sales per month.
  const ls = wb.Sheets["Labour Seasonality"];
  if (ls) {
    const r = util.sheet_to_json(ls, { header: 1, raw: true });
    // Each block header row carries the nominal in col 1 and "Jan" in col 2.
    const blocks = [];
    for (let i = 0; i < r.length; i++) {
      const c1 = r[i] && r[i][1], c2 = r[i] && r[i][2];
      if (typeof c1 === "string" && typeof c2 === "string" && c2.trim().toLowerCase() === "jan") {
        blocks.push({ header: i, raw: c1.trim() });
      }
    }
    // Read each block into store -> [12 monthly fractions].
    const read = (headerRow) => {
      const out = {};
      for (let i = headerRow + 1; i < r.length; i++) {
        const store = r[i] && r[i][1] != null ? String(r[i][1]).trim() : "";
        if (!store) break;                       // block ends at first blank store
        if (typeof r[i][2] === "string") break;  // next block header
        const vals = [];
        for (let m = 0; m < 12; m++) vals.push(Number(r[i][2 + m]) || 0);
        out[store] = vals;
        storesSet.add(store);
      }
      return out;
    };
    const byNominal = {};
    for (const b of blocks) {
      // Map the descriptive header to the P&L nominal.
      const label = b.raw.replace(/\s*\(.*\)\s*$/, "").trim();
      byNominal[label] = read(b.header);
    }
    const basic = byNominal["ST: Salaries - Basic Pay"] || {};
    const holiday = byNominal["ST: Salaries - Holiday Pay"] || {};
    const ni = byNominal["ST: Employers National Insurance"] || {};
    const pension = byNominal["ST: Pensions Costs"] || {};
    const emit = (label, store, ratesByMonth) => {
      records.push({ store, line_label: label, behaviour: "VARIABLE", monthly_amount: null, pct_of_revenue: null, start_ym: null });
      for (let m = 0; m < 12; m++) monthRates.push({ store, line_label: label, scope: "MONTH", period_key: String(m + 1).padStart(2, "0"), pct_of_revenue: ratesByMonth[m] });
    };
    for (const store of Object.keys(basic)) {
      const b = basic[store], h = holiday[store] || new Array(12).fill(0), n = ni[store] || new Array(12).fill(0), p = pension[store] || new Array(12).fill(0);
      const effBasic = [], effHoliday = [], effNI = [], effPension = [];
      for (let m = 0; m < 12; m++) {
        const bh = b[m] * (1 + h[m]);            // (basic + holiday) as % of sales
        effBasic[m] = b[m];
        effHoliday[m] = h[m] * b[m];
        effNI[m] = n[m] * bh;
        effPension[m] = p[m] * bh;
      }
      emit("ST: Salaries - Basic Pay", store, effBasic);
      if (holiday[store]) emit("ST: Salaries - Holiday Pay", store, effHoliday);
      if (ni[store]) emit("ST: Employers National Insurance", store, effNI);
      if (pension[store]) emit("ST: Pensions Costs", store, effPension);
    }
  }

  if (!records.length) warnings.push("Cost model workbook had no usable rows");
  return { records, monthRates, warnings, stores: [...storesSet].sort() };
}

// Simple long tab: Store · Nominal · Behaviour · Monthly Amount · % of Revenue.
function parseLong(wb, warnings) {
  const util = wb._utils;
  let sheetName = null, header = null, rows = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const r = util.sheet_to_json(ws, { header: 1, raw: true });
    const hi = r.findIndex((row) => {
      if (!row) return false;
      const cells = row.map((c) => String(c).trim().toLowerCase());
      const has = (...n) => cells.some((c) => n.includes(c));
      return has("store", "location", "unit") && has("nominal", "nominals", "account", "line") && has("behaviour", "behavior", "type", "basis");
    });
    if (hi >= 0) { sheetName = name; header = r[hi].map((c) => String(c).trim().toLowerCase()); rows = r.slice(hi + 1); break; }
  }
  if (!rows) { warnings.push("No cost-model tab found (needs Store, Nominal and Behaviour columns)"); return { records: [], monthRates: [], stores: [], warnings }; }

  const col = (...names) => header.findIndex((h) => names.includes(h));
  const cStore = col("store", "location", "unit"), cNom = col("nominal", "nominals", "account", "line"),
    cBeh = col("behaviour", "behavior", "type", "basis"),
    cAmt = col("monthly amount", "amount", "fixed amount", "fixed", "monthly £", "monthly"),
    cPct = col("% of revenue", "% revenue", "pct of revenue", "variable %", "rate", "% sales");
  const out = [];
  const storesSet = new Set();
  for (const r of rows) {
    if (!r) continue;
    const store = cStore >= 0 && r[cStore] != null ? String(r[cStore]).trim() : "";
    const nominal = cNom >= 0 && r[cNom] != null ? String(r[cNom]).trim() : "";
    const behaviour = classifyBehaviour(r[cBeh]);
    if (!store || !nominal || !behaviour) continue;
    let monthly_amount = null, pct_of_revenue = null;
    if (behaviour === "FIXED") {
      const cell = cAmt >= 0 ? r[cAmt] : null;
      const a = cell === "" || cell == null ? NaN : Number(cell);
      if (!isFinite(a)) { warnings.push(`${store} · ${nominal}: FIXED with no monthly amount — skipped`); continue; }
      monthly_amount = a;
    } else {
      const p = normaliseRate(cPct >= 0 ? r[cPct] : NaN);
      if (p == null) { warnings.push(`${store} · ${nominal}: VARIABLE with no % of revenue — skipped`); continue; }
      pct_of_revenue = p;
    }
    out.push({ store, line_label: nominal, behaviour, monthly_amount, pct_of_revenue, start_ym: null });
    storesSet.add(store);
  }
  if (!out.length) warnings.push(`Cost-model tab "${sheetName}" had no usable rows`);
  return { records: out, monthRates: [], stores: [...storesSet].sort(), sheet: sheetName, warnings };
}

export function parseCostModelWorkbook(wb) {
  const warnings = [];
  const util = wb._utils;
  // Wide layout is signalled by a "Cost Assumptions" tab with a FIXED COSTS
  // marker, or a "Labour Seasonality" tab.
  const hasWide = wb.SheetNames.includes("Labour Seasonality") ||
    (wb.Sheets["Cost Assumptions"] && util.sheet_to_json(wb.Sheets["Cost Assumptions"], { header: 1, raw: true }).some((row) => row && isMarker(row[1], /^FIXED COSTS/i)));
  if (hasWide) return parseWide(wb, warnings);
  return parseLong(wb, warnings);
}
