/*
 * Sales forecast — pure, unit-testable.
 *
 * The 4-year sales forecast workbook is the source of every forecast sales
 * figure in the app: company and franchise stores, daily, 2026–2029. It loads
 * into the daily store-sales fact as a FORECAST scenario — one scenario per
 * uploaded version — so the store dashboards, the home page and the Executive
 * Intelligence Hub compare actuals against it with no extra plumbing.
 *
 * Two tabs are read:
 *   "Monthly by Store" — which stores are COMPANY and which FRANCHISEE, and the
 *                        file's own SUBTOTAL rows to check against;
 *   "Daily Sales (All)" — the figures themselves, one column per store.
 * The daily tab has no company/franchise marker on its columns, so the monthly
 * tab classifies them, and the daily figures must add up to the monthly ones —
 * a column read under the wrong store would otherwise load silently.
 */

import { parseSalesForecast4yr } from "./forecast-rules.js";

export const SALES_FC_PREFIX = "SALES-FC-";
export const CHANNELS = { COMPANY: "Company", FRANCHISE: "Franchise" };

// Excel stores dates as days since 1899-12-30.
export function excelSerialToIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  return null;
}

/*
 * The daily tab: a header row starting "Date", then TOTAL / Co Total / Fr Total
 * and one column per store. Totals columns are skipped by name so the store
 * columns can be anywhere after them.
 *   → { days: [{ dateIso, store, net }], stores: [names], errors }
 */
export function parseDailySheet(rows = []) {
  const errors = [];
  const hi = (rows || []).findIndex((r) => r && String(r[0] || "").trim().toLowerCase() === "date");
  if (hi < 0) return { days: [], stores: [], errors: ["No 'Date' header row on the Daily Sales tab"] };
  const hdr = rows[hi];
  const skip = /^(date|day|year|total|co total|fr total|company total|franchise total)\b/i;
  const cols = [];
  hdr.forEach((c, i) => {
    const name = typeof c === "string" ? c.trim() : "";
    if (i === 0 || !name || skip.test(name) || /\(£\)/.test(name)) return;
    cols.push({ i, name });
  });
  const days = [];
  for (let ri = hi + 1; ri < rows.length; ri++) {
    const r = rows[ri];
    if (!r) continue;
    const iso = excelSerialToIso(r[0]);
    if (!iso) continue;                       // GRAND TOTAL and other footer rows
    for (const { i, name } of cols) {
      const v = typeof r[i] === "number" && Number.isFinite(r[i]) ? r[i] : null;
      if (v) days.push({ dateIso: iso, store: name, net: v });
    }
  }
  if (!days.length) errors.push("No daily store sales found on the Daily Sales tab");
  return { days, stores: cols.map((c) => c.name), errors };
}

/*
 * The whole workbook: classify the daily columns by the monthly tab, and check
 * the two tabs agree, store by store and month by month, to within rounding.
 *   sheets: { monthly: rows, daily: rows }
 *   → { days: [{ dateIso, store, channel, net }], years, stores, errors }
 */
export function parseSalesForecastWorkbook({ monthly = [], daily = [] } = {}) {
  const m = parseSalesForecast4yr(monthly);
  const d = parseDailySheet(daily);
  const errors = [...m.errors, ...d.errors];
  const channelOf = new Map();
  for (const s of m.stores.company) channelOf.set(s, "COMPANY");
  for (const s of m.stores.franchise) channelOf.set(s, "FRANCHISE");

  const unknown = d.stores.filter((s) => !channelOf.has(s) && d.days.some((x) => x.store === s));
  if (unknown.length) errors.push(`Daily tab has store columns the Monthly tab does not list: ${unknown.slice(0, 6).join(", ")}`);

  // Monthly check: each store-month of the daily tab against the monthly tab.
  const dailyByKey = new Map();
  for (const x of d.days) {
    const k = `${x.store}|${x.dateIso.slice(0, 7)}`;
    dailyByKey.set(k, (dailyByKey.get(k) || 0) + x.net);
  }
  const monthlyByKey = new Map(m.records.map((r) => [`${r.unit}|${r.ym}`, r.value]));
  const off = [];
  for (const k of new Set([...dailyByKey.keys(), ...monthlyByKey.keys()])) {
    const a = dailyByKey.get(k) || 0, b = monthlyByKey.get(k) || 0;
    if (Math.abs(a - b) > 2) off.push(`${k.replace("|", " ")}: daily £${Math.round(a).toLocaleString("en-GB")} vs monthly £${Math.round(b).toLocaleString("en-GB")}`);
  }
  if (off.length) errors.push(`${off.length} store-month${off.length === 1 ? "" : "s"} where the daily and monthly tabs disagree — e.g. ${off.slice(0, 3).join("; ")}`);

  const days = d.days.filter((x) => channelOf.has(x.store)).map((x) => ({ ...x, channel: channelOf.get(x.store) }));
  return { days, years: m.years, stores: m.stores, errors };
}

// Store names are matched loosely: case, spacing and punctuation do not matter,
// and "St"/"Street" are the same word.
export function storeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bstreet\b/g, "st")
    .replace(/[^a-z0-9]+/g, "");
}

/*
 * Forecast stores against the store master.
 *   names:  [{ store, channel }]
 *   master: [{ store_id, store_name, ownership_type, reports?, has_actuals? }]
 *   → { matched: Map(store → store_id), missing: [{ store, channel }] }
 *
 * The master can hold more than one row for a store name — a placeholder from
 * an earlier import, say, with no operator. Taking whichever came first put
 * some of the forecast on rows the dashboards never read (they report stores
 * with an operator that are not OTHER), so the FY plan came in light and the
 * forecast missed the store's actuals. The row that trades, and is reported,
 * wins: `reports` first, then `has_actuals`, then the earliest.
 */
export function storeRank(s = {}) {
  return (s.reports ? 2 : 0) + (s.has_actuals ? 1 : 0);
}
export function matchStores(names = [], master = []) {
  const byKey = new Map();
  for (const s of master || []) {
    const k = storeKey(s.store_name);
    if (!k) continue;
    const cur = byKey.get(k);
    if (!cur || storeRank(s) > storeRank(cur)) byKey.set(k, s);
  }
  const matched = new Map();
  const missing = [];
  for (const n of names) {
    const hit = byKey.get(storeKey(n.store));
    if (hit) matched.set(n.store, Number(hit.store_id));
    else missing.push(n);
  }
  return { matched, missing };
}

// A code for a forecast-only store (one the store master does not know yet —
// typically a store not yet open). Fits dim_store.store_code varchar(30).
export function forecastStoreCode(name) {
  return `FC-${storeKey(name).toUpperCase()}`.slice(0, 30);
}

// "2026-2029_Sales_Forecast_4yr_Sept26_v0.3.xlsx" → "Sept26 v0.3"
export function versionLabelFromFilename(filename = "") {
  const base = String(filename || "").replace(/\.[a-z0-9]+$/i, "");
  const m = /([A-Za-z]{3,9}\d{2})[_\s-]*(v\d+(?:\.\d+)*)/i.exec(base);
  if (m) return `${m[1]} ${m[2]}`;
  return base.replace(/[_]+/g, " ").trim().slice(0, 80) || "Sales forecast";
}

/*
 * Roll a version's monthly store rows up for the page.
 *   rows: [{ store, channel, ym, net }]
 *   → { months: { ym: { company, franchise, total } },
 *       years:  { yyyy: { company, franchise, total } },
 *       stores: [{ store, channel, months: { ym: net }, years: { yyyy: net }, total }] }
 */
export function consolidateForecast(rows = []) {
  const months = {}, years = {}, stores = new Map();
  const add = (o, k, ch, v) => {
    const t = (o[k] ||= { company: 0, franchise: 0, total: 0 });
    if (ch === "COMPANY") t.company += v; else t.franchise += v;
    t.total += v;
  };
  for (const r of rows || []) {
    const v = Number(r.net) || 0;
    if (!v || !r.ym) continue;
    const ch = r.channel === "COMPANY" ? "COMPANY" : "FRANCHISE";
    add(months, r.ym, ch, v);
    add(years, r.ym.slice(0, 4), ch, v);
    const s = stores.get(r.store) || { store: r.store, channel: ch, months: {}, years: {}, total: 0 };
    s.months[r.ym] = (s.months[r.ym] || 0) + v;
    const y = r.ym.slice(0, 4);
    s.years[y] = (s.years[y] || 0) + v;
    s.total += v;
    stores.set(r.store, s);
  }
  return {
    months, years,
    stores: [...stores.values()].sort((a, b) => (a.channel === b.channel ? b.total - a.total : a.channel === "COMPANY" ? -1 : 1)),
  };
}

// The difference between two versions' consolidated years or months: b − a.
export function compareForecasts(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[k] || { company: 0, franchise: 0, total: 0 };
    const y = b?.[k] || { company: 0, franchise: 0, total: 0 };
    out[k] = { company: y.company - x.company, franchise: y.franchise - x.franchise, total: y.total - x.total };
  }
  return out;
}
