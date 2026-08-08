/*
 * Pure parsing/normalisation for the daily Store Sales & KPI upload.
 *
 * Input is the "Combined" sheet of the finance sales workbook — one row per
 * store per day — as a matrix (array of rows, each an array of cells). No I/O
 * here: the DB ingest (lib/store-sales-import.js) reads the workbook into a
 * matrix and hands it over, so all the shape/parse logic is unit-testable.
 *
 * The Combined sheet carries sales, cost-of-sale and store KPIs together:
 *   Store Name · Store No. · Franchise Name · Date · Net Sales · Gross Sales ·
 *   Gross Profit · Valid Day · Net Units Sold · No of Trans · Return Trans ·
 *   Net Transactions · Footfall In · Net Return Value  (+ derived ATV/ATU/etc).
 * We keep only what the dashboard aggregates; derived ratios are recomputed
 * downstream, so they are ignored on import.
 */

// Normalise a header to a comparison key: lowercase alphanumerics only.
export function normHeader(h) {
  return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Each target field and the header keys (already normalised) that map to it.
// First matching column in the sheet wins.
const FIELD_HEADERS = {
  storeName:    ["storename", "store"],
  storeCode:    ["storeno", "storenumber", "storecode"],
  operator:     ["franchisename", "franchise", "operator", "operatorname"],
  date:         ["date", "tradedate", "businessdate"],
  netSales:     ["netsales", "netsales£"],
  grossSales:   ["grosssales", "grosssales£"],
  grossProfit:  ["grossprofit", "grossprofit£"],
  isValidDay:   ["validday", "isvalidday", "valid"],
  unitsSold:    ["netunitssold", "unitssold", "units"],
  transGross:   ["nooftrans", "notrans", "transactions", "transcount"],
  returnTrans:  ["returntranscount", "returntransactions", "returntrans"],
  transNet:     ["nettransactions", "nettrans"],
  footfall:     ["footfallin", "footfall"],
  returnValue:  ["netreturnvalue", "netreturnvalue£", "returnvalue"],
};

// A company-operated store carries no franchisee, or the group's own operator
// label ("Kouriten"/"Miniso"). Everything else is a franchise partner.
export function ownershipFromOperator(operator) {
  const s = String(operator == null ? "" : operator).trim();
  if (!s) return "COMPANY";
  if (/^(kouriten|miniso|company|head\s*office|ho)\b/i.test(s)) return "COMPANY";
  return "FRANCHISE";
}

// Parse a numeric cell: strip £, commas, spaces; blanks / "None" / non-numbers → null.
export function cleanNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || /^(none|null|n\/?a|-)$/i.test(s)) return null;
  const n = Number(s.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Truthy day flag: 1 / "1" / true / "yes" / "y" / "true" → true; 0 / "0" / "no" → false.
export function cleanFlag(v, dflt = true) {
  if (v == null || v === "") return dflt;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "valid"].includes(s)) return true;
  if (["0", "false", "no", "n", "invalid"].includes(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : dflt;
}

// A date cell → ISO 'YYYY-MM-DD', or null. Accepts a JS Date, an ISO-ish string,
// a UK DD/MM/YYYY string, or an Excel serial number (1900 date system).
export function toIsoDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial: day 1 = 1900-01-01, with the well-known 1900 leap-year bug.
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    if (isNaN(d)) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);           // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);          // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return null;
}

// ISO 'YYYY-MM-DD' → integer date_key YYYYMMDD (the fact tables' date grain).
export function dateKey(iso) {
  return iso ? Number(iso.slice(0, 10).replace(/-/g, "")) : null;
}

// Locate the header row (first row that names both a store and a date column)
// and build { field: columnIndex }. Returns null if no plausible header found.
function locateHeader(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const row = matrix[r] || [];
    const keys = row.map(normHeader);
    const idx = {};
    for (const [field, cands] of Object.entries(FIELD_HEADERS)) {
      const at = keys.findIndex((k) => k && cands.includes(k));
      if (at >= 0) idx[field] = at;
    }
    if (idx.storeName != null && idx.date != null && idx.netSales != null) {
      return { headerRow: r, idx };
    }
  }
  return null;
}

/*
 * Parse the matrix into normalised store-day rows.
 * Returns { rows, stores, months, dateMin, dateMax, years, skipped, warnings }.
 * Each row: { storeCode, storeName, operator, ownershipType, dateIso, dateKey,
 *   netSales, grossSales, grossProfit, unitsSold, transactions, transactionsGross,
 *   returnTransactions, footfall, returnValue, isValidDay }.
 */
export function parseSalesRows(matrix) {
  const warnings = [];
  const loc = locateHeader(matrix || []);
  if (!loc) {
    return { rows: [], stores: [], months: [], dateMin: null, dateMax: null, years: [], skipped: 0,
      warnings: ["Could not find the sales header row (need Store Name, Date and Net Sales columns)."] };
  }
  const { headerRow, idx } = loc;
  const get = (row, field) => (idx[field] != null ? row[idx[field]] : undefined);

  const rows = [];
  const stores = new Set();
  const months = new Set();
  const years = new Set();
  let dateMin = null, dateMax = null, skipped = 0;

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const nameRaw = get(row, "storeName");
    const name = nameRaw == null ? "" : String(nameRaw).trim();
    // Skip blanks and export artefacts ("Total", "Applied filters", metadata rows).
    if (!name || /^(total|grand total|applied filters?|filters?)/i.test(name)) { skipped++; continue; }
    const iso = toIsoDate(get(row, "date"));
    if (!iso) { skipped++; continue; }
    const net = cleanNum(get(row, "netSales"));

    const code = (() => {
      const c = get(row, "storeCode");
      const s = c == null ? "" : String(c).trim();
      return s || name; // fall back to the store name as its code
    })();
    const operator = (() => {
      const o = get(row, "operator");
      const s = o == null ? "" : String(o).trim();
      return s || null;
    })();

    const rec = {
      storeCode: code,
      storeName: name,
      operator,
      ownershipType: ownershipFromOperator(operator),
      dateIso: iso,
      dateKey: dateKey(iso),
      netSales: net ?? 0,
      grossSales: cleanNum(get(row, "grossSales")) ?? 0,
      grossProfit: cleanNum(get(row, "grossProfit")),
      unitsSold: cleanNum(get(row, "unitsSold")) ?? 0,
      transactions: cleanNum(get(row, "transNet")) ?? cleanNum(get(row, "transGross")) ?? 0,
      transactionsGross: cleanNum(get(row, "transGross")),
      returnTransactions: cleanNum(get(row, "returnTrans")),
      footfall: cleanNum(get(row, "footfall")),
      returnValue: cleanNum(get(row, "returnValue")),
      isValidDay: cleanFlag(get(row, "isValidDay"), true),
    };
    rows.push(rec);
    stores.add(code);
    months.add(iso.slice(0, 7));
    years.add(Number(iso.slice(0, 4)));
    if (!dateMin || iso < dateMin) dateMin = iso;
    if (!dateMax || iso > dateMax) dateMax = iso;
  }

  if (!rows.length) warnings.push("No data rows found under the header.");
  return {
    rows,
    stores: [...stores],
    months: [...months].sort(),
    years: [...years].sort(),
    dateMin, dateMax, skipped, warnings,
  };
}

// Per-store first/last trading date across the parsed rows (used to stamp the
// store dimension so LFL "mature store" logic has a trading window to test).
export function storeTradingWindows(rows) {
  const byStore = new Map();
  for (const r of rows) {
    let w = byStore.get(r.storeCode);
    if (!w) { w = { storeCode: r.storeCode, storeName: r.storeName, operator: r.operator, ownershipType: r.ownershipType, first: r.dateIso, last: r.dateIso }; byStore.set(r.storeCode, w); }
    if (r.dateIso < w.first) w.first = r.dateIso;
    if (r.dateIso > w.last) w.last = r.dateIso;
    // keep the latest non-null operator/name we see
    if (r.operator) { w.operator = r.operator; w.ownershipType = r.ownershipType; }
    if (r.storeName) w.storeName = r.storeName;
  }
  return [...byStore.values()];
}
