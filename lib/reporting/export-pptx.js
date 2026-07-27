import PptxGenJS from "pptxgenjs";
import { formatReportMoney } from "./reporting-rules";

/*
 * Corporate Reporting Centre — native PowerPoint export (CR §16). Builds a fully
 * formatted deck from an assembled report (native tables/KPIs/commentary — never
 * a screenshot), styled to the Finance OS identity: warm neutral ground, olive
 * accent, restrained status colour, spacious hierarchy. Page-numbered, branded,
 * with a source + data-through footer and optional confidentiality watermark.
 *
 * Input `assembled` shape (from reports.resolveReport / a version snapshot):
 *   { report:{ title, reporting_period, data_through_date, confidentiality, display_units },
 *     sections:[{ title, page_type, kpis:[{label,value,unit}], table:{columns,rows},
 *                 components:[{ type, aiStatus, approvedText, draftText, title }],
 *                 sourceRoute, dataThrough }] }
 */

const C = {
  bg: "FBF9F4", ink: "23231E", muted: "77776E", accent: "73824F",
  line: "E4DFD3", panel: "F3EFE6", white: "FFFFFF",
  green: "4B7A4B", amber: "B6862C", red: "B4483C",
};

const BRAND = "MINISO UK · FINANCE OS";

function fmtKpi(k, units) {
  if (k.unit === "%") return `${k.value}%`;
  if (k.unit === "count") return Number(k.value).toLocaleString("en-GB");
  return formatReportMoney(k.value, units);
}

function footer(slide, { pageNo, report, sourceRoute, dataThrough }) {
  slide.addShape("line", { x: 0.5, y: 5.15, w: 9.0, h: 0, line: { color: C.line, width: 1 } });
  const bits = [BRAND];
  if (sourceRoute) bits.push(`Source: ${sourceRoute}`);
  if (dataThrough) bits.push(`Data through ${String(dataThrough).slice(0, 10)}`);
  slide.addText(bits.join("   ·   "), { x: 0.5, y: 5.2, w: 7.5, h: 0.3, fontSize: 7, color: C.muted, align: "left" });
  slide.addText(`${report.confidentiality || "INTERNAL"}   ·   ${pageNo}`, { x: 8.0, y: 5.2, w: 1.5, h: 0.3, fontSize: 7, color: C.muted, align: "right" });
}

function watermark(slide, text) {
  if (!text) return;
  slide.addText(text, { x: 0.5, y: 2.2, w: 9.0, h: 1.2, fontSize: 54, color: C.line, bold: true, align: "center", rotate: 335, transparency: 60 });
}

export async function buildDeckPptx(assembled, { includeDraftCommentary = false, watermarkText = null } = {}) {
  const { report, sections } = assembled;
  const units = report.display_units || "GBP";
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "FOS", width: 10, height: 5.63 });
  pptx.layout = "FOS";
  pptx.author = "Miniso UK Finance OS";
  pptx.company = "Miniso UK";
  pptx.title = report.title;

  // ---- Cover ----
  const cover = pptx.addSlide();
  cover.background = { color: C.bg };
  cover.addShape("rect", { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C.accent } });
  cover.addText(BRAND, { x: 0.6, y: 0.5, w: 8.8, h: 0.3, fontSize: 10, color: C.accent, bold: true, charSpacing: 2 });
  cover.addText(report.title, { x: 0.6, y: 1.7, w: 8.8, h: 1.2, fontSize: 30, color: C.ink, bold: true });
  const sub = [report.reporting_period, report.data_through_date ? `Data through ${String(report.data_through_date).slice(0, 10)}` : null].filter(Boolean).join("   ·   ");
  cover.addText(sub, { x: 0.6, y: 2.9, w: 8.8, h: 0.4, fontSize: 13, color: C.muted });
  cover.addText(`${report.confidentiality || "INTERNAL"} — governed reporting deck`, { x: 0.6, y: 4.9, w: 8.8, h: 0.3, fontSize: 9, color: C.muted });
  watermark(cover, watermarkText);

  // ---- One slide per included section ----
  let pageNo = 1;
  for (const s of sections) {
    if (s.page_type === "cover") continue;
    const slide = pptx.addSlide();
    slide.background = { color: C.bg };
    pageNo += 1;
    slide.addText(s.title, { x: 0.5, y: 0.4, w: 9.0, h: 0.5, fontSize: 20, color: C.ink, bold: true });
    slide.addShape("line", { x: 0.5, y: 0.95, w: 9.0, h: 0, line: { color: C.accent, width: 2 } });

    let y = 1.2;

    // KPI tiles (up to 5 across).
    const kpis = (s.kpis || []).slice(0, 5);
    if (kpis.length) {
      const gap = 0.15, totalW = 9.0, tileW = (totalW - gap * (kpis.length - 1)) / kpis.length;
      kpis.forEach((k, i) => {
        const x = 0.5 + i * (tileW + gap);
        slide.addShape("roundRect", { x, y, w: tileW, h: 0.95, fill: { color: C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.05 });
        slide.addText(fmtKpi(k, units), { x: x + 0.1, y: y + 0.12, w: tileW - 0.2, h: 0.45, fontSize: 16, bold: true, color: C.ink, align: "left" });
        slide.addText(k.label, { x: x + 0.1, y: y + 0.58, w: tileW - 0.2, h: 0.32, fontSize: 8, color: C.muted, align: "left" });
      });
      y += 1.2;
    }

    // A table, if present.
    if (s.table?.rows?.length) {
      const cols = s.table.columns;
      const head = cols.map((c) => ({ text: c.label, options: { bold: true, color: C.white, fill: { color: C.accent }, fontSize: 9, align: c.align || "left" } }));
      const body = s.table.rows.slice(0, 10).map((r) => cols.map((c) => ({
        text: c.money ? formatReportMoney(r[c.key], units) : String(r[c.key] ?? "—"),
        options: { fontSize: 9, color: C.ink, align: c.align || "left", fill: { color: C.white } },
      })));
      slide.addTable([head, ...body], {
        x: 0.5, y, w: 9.0, border: { type: "solid", color: C.line, pt: 0.5 },
        colW: cols.map(() => 9.0 / cols.length), rowH: 0.28, valign: "middle",
      });
      y += 0.35 + Math.min(10, s.table.rows.length) * 0.28 + 0.15;
    }

    // Approved commentary (or draft, clearly marked, only if requested).
    const commentary = (s.components || []).filter((c) => c.type === "commentary");
    for (const c of commentary) {
      const isApproved = c.aiStatus === "APPROVED";
      if (!isApproved && !includeDraftCommentary) continue;
      const text = isApproved ? (c.approvedText || c.draftText) : c.draftText;
      if (!text) continue;
      if (y > 4.4) break;
      if (!isApproved) {
        slide.addText("AI DRAFT — not yet reviewed", { x: 0.5, y, w: 9.0, h: 0.25, fontSize: 8, bold: true, color: C.amber });
        y += 0.28;
      }
      slide.addText(String(text).slice(0, 900), { x: 0.5, y, w: 9.0, h: Math.min(4.9 - y, 1.6), fontSize: 10, color: C.ink, valign: "top" });
      y += 1.6;
    }

    footer(slide, { pageNo, report, sourceRoute: s.sourceRoute, dataThrough: s.dataThrough });
  }

  return Buffer.from(await pptx.write({ outputType: "nodebuffer" }));
}
