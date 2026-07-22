/*
 * SKU Analysis Dashboard — pure parsing of the distributed workbooks into the
 * tables the dashboard renders (mirroring the decks). Each workbook sheet is a
 * pre-computed table; we locate its header row and map the rows to objects.
 * Input is a { sheetName: arrayOfArrays } map so this stays DB- and
 * SheetJS-free and unit-testable. House style: "Kouriten" in any display text
 * is shown as "Miniso UK".
 */

export const sanitize = (s) => (typeof s === "string" ? s.replace(/Kouriten/g, "Miniso UK") : s);
const numOrStr = (v) => (typeof v === "number" ? v : (v == null ? null : sanitize(String(v).trim())));

// Map a sheet's rows to objects, from the header row whose first cell === firstHeader.
export function mapSheet(aoa, firstHeader) {
  const hi = aoa.findIndex((r) => r && String(r[0]).trim() === firstHeader);
  if (hi < 0) return { headers: [], rows: [] };
  const headers = aoa[hi].map((h) => (h == null ? "" : String(h).trim()));
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r[0] == null || String(r[0]).trim() === "") continue;
    const o = {};
    headers.forEach((h, c) => { if (h) o[h] = numOrStr(r[c]); });
    rows.push(o);
  }
  return { headers, rows };
}

// [label, value] metric pairs after a "KEY METRICS" marker.
function keyMetrics(aoa) {
  const km = aoa.findIndex((r) => r && String(r[0]).trim().toUpperCase() === "KEY METRICS");
  const start = km < 0 ? 0 : km + 1;
  const out = [];
  for (let i = start; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || typeof r[0] !== "string" || r[0].trim() === "") continue;
    if (typeof r[1] === "number") out.push({ label: sanitize(r[0].trim()), value: r[1] });
  }
  return out;
}

// Subtitle line (row index 1) of a sheet, used as the period caption.
const subtitle = (aoa) => (aoa && aoa[1] && typeof aoa[1][0] === "string" ? sanitize(aoa[1][0].trim()) : null);

// Parse the Top 80 / Bottom 20 workbook. sheets: { name: aoa }.
export function parseTop80(sheets) {
  const s = (n) => sheets[n] || [];
  const exec = keyMetrics(s("Executive Summary"));
  const period = subtitle(s("Executive Summary"));
  const top80Store = mapSheet(s("Top 80% Store"), "Store").rows;
  const bottom20Store = mapSheet(s("Bottom 20% Store"), "Store").rows;
  const licence = mapSheet(s("Licence Analysis"), "Licence").rows;
  // Zero sellers can run to thousands — keep the top 200 by SOH Cost for the table.
  const zeroAll = mapSheet(s("Zero Sellers"), "SKU").rows;
  const zeroSellers = zeroAll
    .slice()
    .sort((a, b) => (Number(b["SOH Cost"]) || 0) - (Number(a["SOH Cost"]) || 0))
    .slice(0, 200);
  return { period, exec, top80Store, bottom20Store, licence, zeroSellers, zeroCount: zeroAll.length };
}

/*
 * New SKU (newness) — parse the New SKU Performance sheet (one sheet: SKU-level
 * columns then a 4-column block per store: Sales, SOH, First Rcvd, ST%). Sell-
 * Through is a fraction (1 = 100%). Produces the deck's sections: Big Picture
 * KPIs, Stars (ST% ≥ 15%), Needs Attention (sold but < 15%), Zero sellers, and a
 * per-store scorecard (from the store blocks). aoa = the sheet as arrays.
 */
export function parseNewSku(aoa) {
  if (!aoa || aoa.length < 3) return { bigPicture: [], stars: [], slow: [], zero: [], storeScorecard: [], counts: { skus: 0 } };
  const H = aoa[0];
  const idx = (name) => H.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
  const c = { sku: idx("SKU"), desc: idx("Description"), cat: idx("Category"), price: idx("Price"), gr: idx("GR Qty"), sold: idx("Units Sold"), st: idx("Sell-Through %"), net: idx("Net Sales"), sohR: idx("SOH Retail"), stk: idx("Stores Stocked"), sel: idx("Stores Selling") };
  const N = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const S = (v) => sanitize(String(v ?? "").trim());

  // Store blocks: groups of 4 columns after the SKU-level columns.
  const firstStoreCol = Math.max(c.sel, c.stk, 12) + 1;
  const stores = [];
  for (let col = firstStoreCol; col < H.length; col += 4) { const nm = H[col]; if (nm != null && String(nm).trim()) stores.push({ name: S(nm), col }); }

  // Skip the trailing TOTAL/summary row (its Net Sales equals the whole total).
  const isTotalRow = (v) => /^(grand\s+)?totals?$/i.test(String(v ?? "").trim());
  const data = aoa.slice(2).filter((r) => r && r[c.sku] != null && String(r[c.sku]).trim() && !isTotalRow(r[c.sku]));
  const skus = data.map((r) => ({ description: S(r[c.desc]), category: S(r[c.cat]), price: N(r[c.price]), gr: N(r[c.gr]), sold: N(r[c.sold]), st: N(r[c.st]), net: N(r[c.net]), sohR: N(r[c.sohR]), storesStocked: N(r[c.stk]), storesSelling: N(r[c.sel]) }));

  const cnt = skus.length, soldCnt = skus.filter((s) => s.sold > 0).length;
  const totalSales = skus.reduce((t, s) => t + s.net, 0);
  const grSum = skus.reduce((t, s) => t + s.gr, 0), soldSum = skus.reduce((t, s) => t + s.sold, 0);
  const sohAtRisk = skus.filter((s) => s.st < 0.15).reduce((t, s) => t + s.sohR, 0);
  const bigPicture = [
    { label: "New SKUs received", value: cnt },
    { label: "Hit rate", value: cnt ? soldCnt / cnt : 0, pct: true },
    { label: "Total sales (L4W)", value: totalSales, money: true },
    { label: "Zero sellers", value: cnt - soldCnt },
    { label: "Estate sell-through", value: grSum ? soldSum / grSum : 0, pct: true },
    { label: "SOH at risk (<15% ST)", value: sohAtRisk, money: true },
  ];

  const stars = skus.filter((s) => s.st >= 0.15).sort((a, b) => b.net - a.net)
    .map((s) => ({ Product: s.description, Price: s.price, "Units Rcvd": s.gr, "Units Sold": s.sold, "L4W Sales": s.net, "Sell-Through": s.st, "Stores Selling": s.storesSelling }));
  const slow = skus.filter((s) => s.sold > 0 && s.st < 0.15).sort((a, b) => b.sohR - a.sohR)
    .map((s) => ({ Product: s.description, Category: s.category, Price: s.price, "SOH Retail": s.sohR, "Sell-Through": s.st, "L4W Sales": s.net, "Stores Selling": s.storesSelling }));
  const zero = skus.filter((s) => s.sold <= 0).sort((a, b) => b.sohR - a.sohR)
    .map((s) => ({ Product: s.description, Category: s.category, Price: s.price, "SOH Retail": s.sohR, "Stores Stocked": s.storesStocked }));

  const storeScorecard = stores.map((st) => {
    let newSkus = 0, selling = 0, sales = 0, zeros = 0;
    for (const r of data) {
      const salesV = r[st.col], sohV = r[st.col + 1], frV = r[st.col + 2];
      const stocked = (frV != null && String(frV).trim() !== "") || (sohV != null && sohV !== 0) || (salesV != null && salesV !== 0);
      if (!stocked) continue;
      newSkus++; const sv = Number(salesV) || 0; sales += sv; if (sv > 0) selling++; else zeros++;
    }
    return { Store: st.name, "New SKUs": newSkus, "SKUs Selling": selling, "Hit Rate": newSkus ? selling / newSkus : 0, "L4W Sales": sales, "Zero Sellers": zeros };
  }).filter((s) => s["New SKUs"] > 0).sort((a, b) => b["L4W Sales"] - a["L4W Sales"]);

  return { bigPicture, stars, slow, zero, storeScorecard, counts: { skus: cnt } };
}

/*
 * Dormant stock — parse the Dormant SKU Detail matrix (SKU Code, Description,
 * then a 2-column block per store: Units, Last GR (Excel serial date)). Computes
 * what the raw extract supports: dormant SKU/unit counts, a by-store ranking,
 * aging by last-GR recency, and the biggest dormant SKUs. Retail value, category
 * and sell-through aren't in this file, so the deck's £/category/quadrant views
 * need the priced+categorised summary. aoa = the sheet as arrays.
 */
const AGING_ORDER = ["< 4 wks", "5–8 wks", "9–12 wks", "3–6 mo", "6–12 mo", "> 12 mo / none"];
export function parseDormant(aoa) {
  if (!aoa || aoa.length < 5) return { asOf: null, kpis: [], store: [], aging: [], topSkus: [], counts: { skus: 0 } };
  const title = String(aoa[0]?.[0] || "");
  const asOfM = title.match(/SOH\s+(\d{4}-\d{2}-\d{2})/) || title.match(/(\d{4}-\d{2}-\d{2})/);
  const asOf = asOfM ? asOfM[1] : null;
  const asOfDate = asOf ? new Date(asOf + "T00:00:00Z") : null;

  // store name row is index 2; names sit at every 2nd column from col 2.
  const hdr = aoa[2] || [];
  const stores = [];
  for (let col = 2; col < hdr.length; col += 2) { const nm = hdr[col]; if (nm != null && String(nm).trim()) stores.push({ name: sanitize(String(nm).trim()), col }); }

  const isTotal = (v) => /^(grand\s+)?totals?$/i.test(String(v ?? "").trim());
  const data = aoa.slice(4).filter((r) => r && r[0] != null && String(r[0]).trim() && !isTotal(r[0]));
  const excelToDate = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? new Date(Date.UTC(1899, 11, 30) + n * 86400000) : null; };
  const weeks = (d) => (asOfDate && d ? Math.floor((asOfDate - d) / (7 * 86400000)) : null);
  const bucketOf = (w) => (w == null ? "> 12 mo / none" : w < 4 ? "< 4 wks" : w < 9 ? "5–8 wks" : w < 13 ? "9–12 wks" : w < 26 ? "3–6 mo" : w < 52 ? "6–12 mo" : "> 12 mo / none");

  const storeAgg = stores.map((s) => ({ name: s.name, skus: 0, units: 0 }));
  const aging = Object.fromEntries(AGING_ORDER.map((b) => [b, 0]));
  const skuRows = [];
  for (const r of data) {
    let totUnits = 0, storeCount = 0;
    stores.forEach((s, i) => {
      const u = Number(r[s.col]) || 0;
      if (u <= 0) return;
      storeAgg[i].skus++; storeAgg[i].units += u; totUnits += u; storeCount++;
      aging[bucketOf(weeks(excelToDate(r[s.col + 1])))] += u;
    });
    if (totUnits > 0) skuRows.push({ sku: String(r[0]).trim(), description: sanitize(String(r[1] || "")), stores: storeCount, units: totUnits });
  }

  const totalUnits = skuRows.reduce((t, s) => t + s.units, 0);
  const kpis = [
    { label: "Dormant SKUs", value: skuRows.length },
    { label: "Dormant units on hand", value: totalUnits },
    { label: "Stores", value: stores.length },
    { label: "SKU × store lines", value: storeAgg.reduce((t, s) => t + s.skus, 0) },
  ];
  const store = storeAgg.slice().sort((a, b) => b.units - a.units).map((s) => ({ Store: s.name, "Dormant SKUs": s.skus, "Dormant Units": s.units }));
  const agingRows = AGING_ORDER.map((b) => ({ Bucket: b, Units: aging[b], "% of Units": totalUnits ? aging[b] / totalUnits : 0 }));
  const topSkus = skuRows.slice().sort((a, b) => b.units - a.units).slice(0, 200).map((s) => ({ SKU: s.sku, Description: s.description, "Stores Holding": s.stores, "Units on Hand": s.units }));
  return { asOf, kpis, store, aging: agingRows, topSkus, counts: { skus: skuRows.length } };
}

export function toStorageRowsDormant(parsed) {
  const rows = [{ sheet_key: "meta", seq: 0, data: { asOf: parsed.asOf, skus: parsed.counts?.skus ?? null } }];
  const push = (key, arr) => (arr || []).forEach((d, i) => rows.push({ sheet_key: key, seq: i, data: d }));
  push("kpis", parsed.kpis);
  push("store", parsed.store);
  push("aging", parsed.aging);
  push("top_skus", parsed.topSkus);
  return rows;
}

export function toStorageRowsNewSku(parsed) {
  const rows = [{ sheet_key: "meta", seq: 0, data: { skus: parsed.counts?.skus ?? null } }];
  const push = (key, arr) => (arr || []).forEach((d, i) => rows.push({ sheet_key: key, seq: i, data: d }));
  push("bigpicture", parsed.bigPicture);
  push("stars", parsed.stars);
  push("slow", parsed.slow);
  push("zero", parsed.zero);
  push("store_scorecard", parsed.storeScorecard);
  return rows;
}

// Flatten a parsed report into storable rows: [{ sheet_key, seq, data }].
export function toStorageRows(parsed) {
  const rows = [];
  rows.push({ sheet_key: "meta", seq: 0, data: { period: parsed.period, zeroCount: parsed.zeroCount ?? null } });
  const push = (key, arr) => (arr || []).forEach((d, i) => rows.push({ sheet_key: key, seq: i, data: d }));
  push("exec", parsed.exec);
  push("top80_store", parsed.top80Store);
  push("bottom20_store", parsed.bottom20Store);
  push("licence", parsed.licence);
  push("zero_sellers", parsed.zeroSellers);
  return rows;
}
