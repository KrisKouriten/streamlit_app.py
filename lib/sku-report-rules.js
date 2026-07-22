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
