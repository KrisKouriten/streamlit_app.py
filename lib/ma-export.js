import * as XLSX from "xlsx";
import { resolveAllTabs } from "./ma-boardpack-view";
import { applyPeriod, buildTabAoa, PERIOD_LABEL } from "./ma-export-rules";

/*
 * Management Accounts board-pack → Excel. One sheet per loaded scope (Store /
 * Head Office / Franchise / Consolidated) for the chosen year and reporting
 * period, rendered from the SAME resolveTab + applyPeriod path as the screen so
 * the workbook matches the app exactly. Money cells format #,##0; margin rows
 * format 0.0%. Returns a Buffer, or null when no scope has actuals loaded.
 *
 * This is internal management reporting (management accounts), not statutory
 * accounts — a review-before-external-use note is stamped on every sheet.
 */

const TITLE = "Miniso UK — Management Accounts";
const REVIEW_NOTE = "Internal management reporting — review before any external use.";

function safeSheetName(name, used) {
  let base = String(name).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = base, i = 2;
  while (used.has(n)) { const suffix = ` (${i++})`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n);
  return n;
}

function appendTabSheet(wb, used, { tab, label, data }, period) {
  const view = applyPeriod(data, period);
  const { aoa, pctRowsIdx, colCount } = buildTabAoa(view, label);

  // Title block above the table, then a review-note footer below it.
  const subtitle = `${label} · ${PERIOD_LABEL[period] || period} · ${data.year}`;
  const head = [[TITLE], [subtitle], []]; // rows 0,1,2
  const offset = head.length;
  const footer = [[], [REVIEW_NOTE]];
  const full = [...head, ...aoa, ...footer];

  const ws = XLSX.utils.aoa_to_sheet(full);

  // Number formats: percentage rows get 0.0%, every other numeric cell #,##0.
  const pct = new Set(pctRowsIdx.map((i) => i + offset)); // shift into full-sheet coords
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = Math.max(range.s.c, 1); c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = pct.has(r) ? "0.0%" : "#,##0";
    }
  }

  // First column wide for labels; value columns even; keep the header row (and
  // title) frozen so long packs stay readable while scrolling.
  ws["!cols"] = [{ wch: 34 }, ...Array.from({ length: Math.max(0, colCount - 1) }, () => ({ wch: 13 }))];
  ws["!freeze"] = { xSplit: 1, ySplit: offset + 1 };

  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(label || tab, used));
}

export async function buildManagementAccountsWorkbook({ year = null, period = "current" } = {}) {
  const tabs = await resolveAllTabs(year);
  if (!tabs.length) return null;

  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const t of tabs) appendTabSheet(wb, used, t, period);

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
