/*
 * SKU analysis — pure, unit-testable. Three lenses:
 *   80/20 sellers — Pareto: rank by TTM revenue, cumulative share; class A
 *     (drives up to 80%), B (to 95%), C (the long tail).
 *   New SKU performance — launched within the window; how they're tracking.
 *   Dormant SKUs — not sold within the dormancy window (or never), still
 *     carrying stock.
 * The reference month ("as of") is the latest last-sold month in the data, so
 * results are deterministic regardless of the wall clock.
 */

import { parseCsv } from "./intercompany-rules.js";

export const NEW_WINDOW_MONTHS = 6;
export const DORMANT_MONTHS = 6;

const ymToInt = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(ym || ""); return m ? +m[1] * 12 + (+m[2] - 1) : null; };
const monthsBetween = (a, b) => (ymToInt(a) == null || ymToInt(b) == null ? null : ymToInt(a) - ymToInt(b));

export function asOfMonth(rows) {
  let max = null;
  for (const r of rows) { const v = ymToInt(r.last_sold_ym); if (v != null && (max == null || v > max)) max = v; }
  if (max == null) return null;
  return `${Math.floor(max / 12)}-${String((max % 12) + 1).padStart(2, "0")}`;
}

export function pareto(rows) {
  const sold = rows.filter((r) => Number(r.revenue_ttm) > 0).sort((a, b) => Number(b.revenue_ttm) - Number(a.revenue_ttm));
  const total = sold.reduce((s, r) => s + Number(r.revenue_ttm), 0);
  let cum = 0;
  const ranked = sold.map((r, i) => {
    cum += Number(r.revenue_ttm);
    const cumPct = total ? cum / total : 0;
    const prevPct = total ? (cum - Number(r.revenue_ttm)) / total : 0;
    const cls = prevPct < 0.8 ? "A" : prevPct < 0.95 ? "B" : "C";
    return { ...r, rank: i + 1, revenue_ttm: Number(r.revenue_ttm), sharePct: total ? Number(r.revenue_ttm) / total : 0, cumPct, cls };
  });
  const classCount = (c) => ranked.filter((r) => r.cls === c).length;
  const classRev = (c) => ranked.filter((r) => r.cls === c).reduce((s, r) => s + r.revenue_ttm, 0);
  return {
    ranked, total,
    aCount: classCount("A"), aRevPct: total ? classRev("A") / total : 0,
    tailCount: classCount("B") + classCount("C"),
  };
}

export function newSkus(rows, asOf, months = NEW_WINDOW_MONTHS) {
  return rows
    .filter((r) => { const age = monthsBetween(asOf, r.launch_ym); return age != null && age >= 0 && age < months; })
    .map((r) => ({ ...r, months_live: monthsBetween(asOf, r.launch_ym) + 1, revenue_ttm: Number(r.revenue_ttm), units_ttm: Number(r.units_ttm) }))
    .sort((a, b) => b.revenue_ttm - a.revenue_ttm);
}

export function dormant(rows, asOf, months = DORMANT_MONTHS) {
  return rows
    .filter((r) => { const gap = monthsBetween(asOf, r.last_sold_ym); return gap == null || gap >= months || Number(r.revenue_ttm) === 0; })
    .map((r) => ({ ...r, months_since: monthsBetween(asOf, r.last_sold_ym), stock_value: Number(r.stock_value) }))
    .sort((a, b) => Number(b.stock_value) - Number(a.stock_value));
}

// --- CSV: SKU, Description, Category, Launch Month, Last Sold Month, Units TTM, Revenue TTM, Margin %, Stock Value
export const SKU_CSV_TEMPLATE = "SKU,Description,Category,Launch Month,Last Sold Month,Units TTM,Revenue TTM,Margin %,Stock Value";

const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[£$,%\s]/g, "")); return Number.isFinite(n) ? n : null; };
const ym = (v) => { const s = String(v || "").trim(); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : (/^\d{1,2}\/\d{4}$/.test(s) ? `${s.split("/")[1]}-${s.split("/")[0].padStart(2, "0")}` : null); };

export function parseSkuCsv(text) {
  const { headers, records } = parseCsv(text);
  const h = headers.map((x) => x.toLowerCase().trim());
  const col = (...frags) => { const i = h.findIndex((x) => frags.some((f) => x.includes(f))); return i < 0 ? null : headers[i]; };
  const cSku = col("sku"), cDesc = col("description", "desc"), cCat = col("category"),
    cLaunch = col("launch"), cLast = col("last sold", "last"), cUnits = col("units"),
    cRev = col("revenue"), cMargin = col("margin"), cStock = col("stock");
  const out = [], errors = [];
  records.forEach((r, idx) => {
    const sku = cSku ? String(r[cSku] || "").trim() : "";
    if (!sku) { errors.push({ row: idx + 2, reason: "missing SKU" }); return; }
    let margin = cMargin ? num(r[cMargin]) : null; if (margin != null && margin > 1) margin = margin / 100;
    out.push({
      sku, description: cDesc ? String(r[cDesc] || "").trim() || null : null,
      category: cCat ? String(r[cCat] || "").trim() || null : null,
      launch_ym: cLaunch ? ym(r[cLaunch]) : null, last_sold_ym: cLast ? ym(r[cLast]) : null,
      units_ttm: num(cUnits ? r[cUnits] : 0) || 0, revenue_ttm: num(cRev ? r[cRev] : 0) || 0,
      margin_pct: margin, stock_value: num(cStock ? r[cStock] : 0) || 0,
    });
  });
  return { records: out, errors };
}
