import * as XLSX from "xlsx";
import { query } from "./db";
import { parseTop80, toStorageRows, parseNewSku, toStorageRowsNewSku, parseDormant, toStorageRowsDormant } from "./sku-report-rules.js";

/*
 * SKU Analysis Dashboard — DB layer. Ingests the distributed workbooks
 * (Top 80 / Bottom 20 now; Dormant once its computed summary lands) into
 * finance.sku_analysis, one row per sheet line, and reads them back grouped by
 * sheet for the dashboard. Reads xlsx and xlsb (SheetJS handles both).
 */
const tableMissing = (e) => e?.code === "42P01";
const NEEDED = ["Executive Summary", "Top 80% Store", "Bottom 20% Store", "Licence Analysis", "Zero Sellers"];

// Store an already-extracted sheet map ({ name: arrayOfArrays }). This is the
// path the browser uses — it parses the workbook client-side and posts only the
// small extracted tables, so a large .xlsb never hits the request-body limit.
export async function ingestTop80(sheets, actor) {
  if (!sheets || !Object.keys(sheets).length) throw new Error(`No recognised sheets found. Expected: ${NEEDED.join(", ")}.`);
  const parsed = parseTop80(sheets);
  const rows = toStorageRows(parsed);
  await query(`DELETE FROM finance.sku_analysis WHERE report_kind = 'top80'`);
  for (const r of rows) {
    await query(
      `INSERT INTO finance.sku_analysis (report_kind, sheet_key, seq, data, updated_by)
       VALUES ('top80', $1, $2, $3, $4)`,
      [r.sheet_key, r.seq, JSON.stringify(r.data), actor || "upload"]
    );
  }
  return { sheets: Object.keys(sheets), storeCount: parsed.top80Store.length, licenceCount: parsed.licence.length, zeroCount: parsed.zeroCount };
}

// Server-side path (reads the raw workbook buffer) — used by the seed loader/tests.
export async function ingestTop80Workbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheets = {};
  for (const name of NEEDED) if (wb.Sheets[name]) sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
  return ingestTop80(sheets, actor);
}

// New SKU (newness): parse the single New SKU Performance sheet and store it.
const NEWSKU_SHEET = "New SKU Performance";
export async function ingestNewSku(sheets, actor) {
  const aoa = sheets?.[NEWSKU_SHEET] || sheets?.[Object.keys(sheets || {})[0]];
  if (!aoa) throw new Error(`No "${NEWSKU_SHEET}" sheet found in the workbook.`);
  const parsed = parseNewSku(aoa);
  if (!parsed.counts.skus) throw new Error("No new-SKU rows found in the sheet.");
  const rows = toStorageRowsNewSku(parsed);
  await query(`DELETE FROM finance.sku_analysis WHERE report_kind = 'newsku'`);
  for (const r of rows) {
    await query(
      `INSERT INTO finance.sku_analysis (report_kind, sheet_key, seq, data, updated_by) VALUES ('newsku', $1, $2, $3, $4)`,
      [r.sheet_key, r.seq, JSON.stringify(r.data), actor || "upload"]
    );
  }
  return { skus: parsed.counts.skus, stars: parsed.stars.length, slow: parsed.slow.length, zero: parsed.zero.length, stores: parsed.storeScorecard.length };
}

export async function getNewSkuReport() {
  let rows;
  try {
    ({ rows } = await query(`SELECT sheet_key, seq, data FROM finance.sku_analysis WHERE report_kind = 'newsku' ORDER BY sheet_key, seq`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };
  const by = {};
  for (const r of rows) (by[r.sheet_key] ||= []).push(r.data);
  return {
    ready: true, loaded: true,
    bigPicture: by.bigpicture || [], stars: by.stars || [], slow: by.slow || [], zero: by.zero || [], storeScorecard: by.store_scorecard || [],
  };
}

// Dormant: parse the SKU×store matrix and store the units-based analysis.
const DORMANT_SHEET = "Dormant SKU Detail";
export async function ingestDormant(sheets, actor) {
  const aoa = sheets?.[DORMANT_SHEET] || sheets?.[Object.keys(sheets || {})[0]];
  if (!aoa) throw new Error(`No "${DORMANT_SHEET}" sheet found in the workbook.`);
  const parsed = parseDormant(aoa);
  if (!parsed.counts.skus) throw new Error("No dormant SKU rows found in the sheet.");
  const rows = toStorageRowsDormant(parsed);
  await query(`DELETE FROM finance.sku_analysis WHERE report_kind = 'dormant'`);
  for (const r of rows) {
    await query(
      `INSERT INTO finance.sku_analysis (report_kind, sheet_key, seq, data, updated_by) VALUES ('dormant', $1, $2, $3, $4)`,
      [r.sheet_key, r.seq, JSON.stringify(r.data), actor || "upload"]
    );
  }
  return { skus: parsed.counts.skus, stores: parsed.store.length, asOf: parsed.asOf };
}

export async function getDormantReport() {
  let rows;
  try {
    ({ rows } = await query(`SELECT sheet_key, seq, data FROM finance.sku_analysis WHERE report_kind = 'dormant' ORDER BY sheet_key, seq`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };
  const by = {};
  for (const r of rows) (by[r.sheet_key] ||= []).push(r.data);
  return {
    ready: true, loaded: true, asOf: by.meta?.[0]?.asOf || null,
    kpis: by.kpis || [], store: by.store || [], aging: by.aging || [], topSkus: by.top_skus || [],
  };
}

export async function getSkuReport(kind = "top80") {
  let rows;
  try {
    ({ rows } = await query(`SELECT sheet_key, seq, data FROM finance.sku_analysis WHERE report_kind = $1 ORDER BY sheet_key, seq`, [kind]));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };
  const by = {};
  for (const r of rows) (by[r.sheet_key] ||= []).push(r.data);
  const meta = by.meta?.[0] || {};
  return {
    ready: true, loaded: true,
    period: meta.period || null, zeroCount: meta.zeroCount ?? null,
    exec: by.exec || [], top80Store: by.top80_store || [], bottom20Store: by.bottom20_store || [],
    licence: by.licence || [], zeroSellers: by.zero_sellers || [],
  };
}
