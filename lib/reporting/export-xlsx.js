import * as XLSX from "xlsx";
import { formatReportMoney } from "./reporting-rules";

/*
 * Corporate Reporting Centre — Excel appendix (CR §16). Turns an assembled
 * report's section tables + KPIs into a supporting workbook: a summary sheet of
 * all KPIs and one sheet per section that carries a table. Raw numbers are
 * written (Excel formats them) so the appendix is analysable, not a picture.
 */

const REVIEW_NOTE = "Miniso UK — internal management reporting. Review before any external use.";

function safeName(name, used) {
  let base = String(name).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = base, i = 2;
  while (used.has(n)) { const sfx = ` (${i++})`; n = base.slice(0, 31 - sfx.length) + sfx; }
  used.add(n);
  return n;
}

export function buildAppendixWorkbook(assembled, { watermarkText = null } = {}) {
  const { report, sections } = assembled;
  const units = report.display_units || "GBP";
  const wb = XLSX.utils.book_new();
  const used = new Set();

  // Summary sheet: every KPI across the report.
  const summary = [[report.title], [report.reporting_period || ""], [], ["Section", "KPI", "Value"]];
  for (const s of sections) for (const k of (s.kpis || [])) {
    const v = k.unit === "%" ? `${k.value}%` : k.unit === "count" ? Number(k.value) : formatReportMoney(k.value, units);
    summary.push([s.title, k.label, v]);
  }
  summary.push([], [REVIEW_NOTE]);
  if (watermarkText) summary.push([watermarkText]);
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0["!cols"] = [{ wch: 34 }, { wch: 34 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws0, safeName("Summary", used));

  // One sheet per section that has a table.
  for (const s of sections) {
    if (!s.table?.rows?.length) continue;
    const cols = s.table.columns;
    const aoa = [[s.title], [], cols.map((c) => c.label)];
    for (const r of s.table.rows) aoa.push(cols.map((c) => (r[c.key] == null ? null : r[c.key])));
    aoa.push([], [REVIEW_NOTE]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Money columns → #,##0
    const range = XLSX.utils.decode_range(ws["!ref"]);
    cols.forEach((c, ci) => {
      if (!c.money) return;
      for (let r = 3; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
        if (cell && cell.t === "n") cell.z = "#,##0";
      }
    });
    ws["!cols"] = cols.map((c, i) => ({ wch: i === 0 ? 30 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, safeName(s.title, used));
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
