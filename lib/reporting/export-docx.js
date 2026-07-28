import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from "docx";
import { formatReportMoney } from "./reporting-rules";

/*
 * Corporate Reporting Centre — native Word (.docx) export. Builds a real Office
 * Open XML document from an assembled report (native headings, KPI + data tables
 * and governed commentary — never a screenshot), so a finance memo / board write-up
 * drops straight into Word. Mirrors the PPTX exporter's input shape and honesty
 * rules: draft commentary is clearly marked and only included when asked, and a
 * DRAFT / confidentiality banner sits at the head of the document.
 *
 * Input `assembled` shape (see export-pptx.js):
 *   { report:{ title, reporting_period, data_through_date, confidentiality, display_units },
 *     sections:[{ title, page_type, kpis:[{label,value,unit}], table:{columns,rows},
 *                 components:[{ type, aiStatus, approvedText, draftText, title }],
 *                 sourceRoute, dataThrough }] }
 */

const ACCENT = "73824F";
const INK = "23231E";
const MUTED = "77776E";
const AMBER = "B6862C";
const BRAND = "MINISO UK · FINANCE OS";

function fmtKpi(k, units) {
  if (k.unit === "%") return `${k.value}%`;
  if (k.unit === "count") return Number(k.value).toLocaleString("en-GB");
  return formatReportMoney(k.value, units);
}

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellBorders = (color) => ({
  top: { style: BorderStyle.SINGLE, size: 2, color }, bottom: { style: BorderStyle.SINGLE, size: 2, color },
  left: { style: BorderStyle.SINGLE, size: 2, color }, right: { style: BorderStyle.SINGLE, size: 2, color },
});

function kpiTable(kpis, units) {
  const cells = kpis.slice(0, 5).map((k) => new TableCell({
    borders: cellBorders("E4DFD3"),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({ children: [new TextRun({ text: fmtKpi(k, units), bold: true, size: 26, color: INK })] }),
      new Paragraph({ children: [new TextRun({ text: k.label, size: 16, color: MUTED })] }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cells })] });
}

function dataTable(table, units) {
  const cols = table.columns;
  const header = new TableRow({
    tableHeader: true,
    children: cols.map((c) => new TableCell({
      shading: { fill: ACCENT }, borders: cellBorders(ACCENT), margins: { top: 40, bottom: 40, left: 100, right: 100 },
      children: [new Paragraph({ alignment: c.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: c.label, bold: true, color: "FFFFFF", size: 18 })] })],
    })),
  });
  const body = table.rows.slice(0, 40).map((r) => new TableRow({
    children: cols.map((c) => new TableCell({
      borders: cellBorders("E4DFD3"), margins: { top: 40, bottom: 40, left: 100, right: 100 },
      children: [new Paragraph({ alignment: c.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: c.money ? formatReportMoney(r[c.key], units) : String(r[c.key] ?? "—"), size: 18, color: INK })] })],
    })),
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

export async function buildReportDocx(assembled, { includeDraftCommentary = false, watermarkText = null } = {}) {
  const { report, sections } = assembled;
  const units = report.display_units || "GBP";
  const children = [];

  // Brand + title block.
  children.push(new Paragraph({ children: [new TextRun({ text: BRAND, bold: true, color: ACCENT, size: 18, characterSpacing: 20 })] }));
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: report.title || "Report", bold: true, size: 52, color: INK })] }));
  const sub = [report.reporting_period, report.data_through_date ? `Data through ${String(report.data_through_date).slice(0, 10)}` : null].filter(Boolean).join("   ·   ");
  if (sub) children.push(new Paragraph({ children: [new TextRun({ text: sub, size: 20, color: MUTED })] }));
  if (watermarkText) {
    children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `— ${watermarkText} —`, bold: true, color: AMBER, size: 22 })] }));
  }
  children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${report.confidentiality || "INTERNAL"} — governed reporting document`, size: 16, color: MUTED })] }));

  for (const s of sections) {
    if (s.page_type === "cover") continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 100 }, children: [new TextRun({ text: s.title, bold: true, color: INK, size: 30 })] }));

    const kpis = (s.kpis || []).filter(Boolean);
    if (kpis.length) { children.push(kpiTable(kpis, units)); children.push(new Paragraph({ text: "" })); }

    if (s.table?.rows?.length) { children.push(dataTable(s.table, units)); children.push(new Paragraph({ text: "" })); }

    for (const c of (s.components || []).filter((c) => c.type === "commentary")) {
      const isApproved = c.aiStatus === "APPROVED";
      if (!isApproved && !includeDraftCommentary) continue;
      const text = isApproved ? (c.approvedText || c.draftText) : c.draftText;
      if (!text) continue;
      if (!isApproved) children.push(new Paragraph({ children: [new TextRun({ text: "AI DRAFT — not yet reviewed", bold: true, color: AMBER, size: 16 })] }));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: String(text), size: 20, color: INK })] }));
    }

    const foot = [report.confidentiality || "INTERNAL"];
    if (s.sourceRoute) foot.push(`Source: ${s.sourceRoute}`);
    if (s.dataThrough) foot.push(`Data through ${String(s.dataThrough).slice(0, 10)}`);
    children.push(new Paragraph({ children: [new TextRun({ text: foot.join("   ·   "), size: 14, color: MUTED, italics: true })] }));
  }

  const doc = new Document({
    creator: "Miniso UK Finance OS", title: report.title || "Report",
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
