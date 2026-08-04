/*
 * Store cost model — pure helpers. The fixed / variable cost expectation per
 * store × nominal, uploaded on Data Uploads:
 *  - parseCostModelWorkbook: reads a long tab (Store · Nominal · Behaviour ·
 *    Monthly Amount · % of Revenue) into expectation records.
 *  - expectedForMonth: the expected £ for a month — the fixed amount, or the
 *    variable rate applied to that store's revenue.
 * Consumed by the accrual review (accrual-rules.js). Unit-tested in
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

// The expected £ for one month given a store's revenue that month.
export function expectedForMonth(exp, revenue = 0) {
  if (!exp) return 0;
  if (exp.behaviour === "FIXED") return Number(exp.monthly_amount) || 0;
  if (exp.behaviour === "VARIABLE") return (Number(exp.pct_of_revenue) || 0) * (Number(revenue) || 0);
  return 0;
}

export function parseCostModelWorkbook(wb) {
  const util = wb._utils;
  const warnings = [];
  // Find the tab whose header carries Store + Nominal + Behaviour.
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
  if (!rows) { warnings.push("No cost-model tab found (needs Store, Nominal and Behaviour columns)"); return { records: [], warnings, stores: [] }; }

  const col = (...names) => header.findIndex((h) => names.includes(h));
  const cStore = col("store", "location", "unit"),
    cNom = col("nominal", "nominals", "account", "line"),
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
    out.push({ store, line_label: nominal, behaviour, monthly_amount, pct_of_revenue });
    storesSet.add(store);
  }
  if (!out.length) warnings.push(`Cost-model tab "${sheetName}" had no usable rows`);
  return { records: out, warnings, stores: [...storesSet].sort(), sheet: sheetName };
}
