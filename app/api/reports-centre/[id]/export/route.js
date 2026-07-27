import { createHash } from "crypto";
import { getSession, hasRole } from "../../../../../lib/auth";
import { scopeForSession } from "../../../../../lib/intelligence/permission";
import { resolveReport, getVersion, recordExport } from "../../../../../lib/reporting/reports";
import { buildDeckPptx } from "../../../../../lib/reporting/export-pptx";
import { buildAppendixWorkbook } from "../../../../../lib/reporting/export-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Map a live resolved report to the export "assembled" shape.
function assembleFromResolved(resolved) {
  return {
    report: resolved.report,
    sections: resolved.sections.map((s) => ({
      title: s.title, page_type: s.page_type,
      kpis: s.envelope?.kpis || [], table: s.envelope?.table || null,
      sourceRoute: s.envelope?.metadata?.sourceRoute || null,
      dataThrough: s.envelope?.metadata?.dataThrough || null,
      components: (s.components || []).map((c) => ({
        type: c.component_type, aiStatus: c.ai_status, title: c.title,
        approvedText: c.approved_text, draftText: c.draft_text,
      })),
    })),
  };
}

export async function GET(request, { params }) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) return new Response(JSON.stringify({ error: "Not authorised" }), { status: 403 });
  const { id } = await params;
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "pptx").toLowerCase();
  const versionId = url.searchParams.get("version");
  const scope = scopeForSession(session);

  // Prefer a locked version snapshot when asked; else resolve live.
  let assembled, sourceVersionId = null;
  if (versionId) {
    const v = await getVersion(versionId);
    if (!v) return new Response(JSON.stringify({ error: "Version not found" }), { status: 404 });
    assembled = v.snapshot;
    sourceVersionId = v.version_id;
  } else {
    const resolved = await resolveReport(id, scope);
    if (!resolved) return new Response(JSON.stringify({ error: "Report not found" }), { status: 404 });
    assembled = assembleFromResolved(resolved);
  }

  const report = assembled.report || {};
  const isFinal = ["APPROVED", "ISSUED"].includes(report.status);
  const watermarkText = !isFinal ? "DRAFT" : (["BOARD", "RESTRICTED"].includes(report.confidentiality) ? report.confidentiality : null);

  let buffer, contentType, ext;
  if (format === "xlsx") {
    buffer = buildAppendixWorkbook(assembled);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    ext = "xlsx";
  } else {
    buffer = await buildDeckPptx(assembled, { includeDraftCommentary: !isFinal, watermarkText });
    contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    ext = "pptx";
  }

  const checksum = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  await recordExport(id, {
    versionId: sourceVersionId, format: ext.toUpperCase(), checksum, byteSize: buffer.length,
    watermark: watermarkText, confidentiality: report.confidentiality,
  }, session);

  const safeTitle = String(report.title || "report").replace(/[^\w.-]+/g, "-").slice(0, 60);
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeTitle}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
}
