import * as XLSX from "xlsx";
import { query } from "./db";
import { parseTop80, toStorageRows } from "./sku-report-rules.js";

/*
 * SKU Analysis Dashboard — DB layer. Ingests the distributed workbooks
 * (Top 80 / Bottom 20 now; Dormant once its computed summary lands) into
 * finance.sku_analysis, one row per sheet line, and reads them back grouped by
 * sheet for the dashboard. Reads xlsx and xlsb (SheetJS handles both).
 */
const tableMissing = (e) => e?.code === "42P01";
const NEEDED = ["Executive Summary", "Top 80% Store", "Bottom 20% Store", "Licence Analysis", "Zero Sellers"];

export async function ingestTop80Workbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheets = {};
  for (const name of NEEDED) if (wb.Sheets[name]) sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
  const found = Object.keys(sheets);
  if (!found.length) throw new Error(`No recognised sheets found. Expected: ${NEEDED.join(", ")}.`);

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
  return { sheets: found, storeCount: parsed.top80Store.length, licenceCount: parsed.licence.length, zeroCount: parsed.zeroCount };
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
