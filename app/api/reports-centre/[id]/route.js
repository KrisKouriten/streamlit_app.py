import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { scopeForSession } from "../../../../lib/intelligence/permission";
import {
  getReport, resolveReport, validateReportById, updateReport, setSectionIncluded,
  reorderReportSections, addComponent, removeComponent, transitionReport, snapshotVersion, listVersions,
} from "../../../../lib/reporting/reports";
import { generateReportCommentary, editReportCommentary, reviewReportCommentary } from "../../../../lib/reporting/report-commentary";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // AI commentary + multi-adapter resolution

const canManage = (s) => hasRole(s, "ADMIN", "FINANCE");

// GET a fully resolved report + validation (the builder reads this).
export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const scope = scopeForSession(session);
  const resolved = await resolveReport(id, scope);
  if (!resolved) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const validation = await validateReportById(id, scope);
  const versions = await listVersions(id);
  return NextResponse.json({ ok: true, ...resolved, validation, versions });
}

// POST a mutating operation. Finance/admin only. `op` selects the action.
export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised to edit reports" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const scope = scopeForSession(session);
  try {
    switch (body.op) {
      case "update":
        return NextResponse.json(await updateReport(id, body.patch || {}, session));
      case "section-toggle":
        return NextResponse.json(await setSectionIncluded(id, body.sectionInstId, body.included, session));
      case "section-reorder":
        return NextResponse.json(await reorderReportSections(id, body.orderedIds || [], session));
      case "add-component":
        return NextResponse.json(await addComponent(id, body.sectionInstId, body.component || {}, session));
      case "remove-component":
        return NextResponse.json(await removeComponent(id, body.componentId, session));
      case "transition":
        return NextResponse.json(await transitionReport(id, body.action, session, { scope, note: body.note, changeSummary: body.changeSummary }));
      case "snapshot":
        return NextResponse.json({ ok: true, versionId: await snapshotVersion(id, { scope, status: "DRAFT", label: body.label, changeSummary: body.changeSummary }, session) });
      case "commentary-generate":
        return NextResponse.json(await generateReportCommentary({
          reportId: id, sectionInstId: body.sectionInstId, componentId: body.componentId || null,
          perspective: body.perspective, detailLevel: body.detailLevel, tone: body.tone, actor: session,
        }));
      case "commentary-edit":
        return NextResponse.json(await editReportCommentary(body.componentId, body.text || "", session));
      case "commentary-review":
        return NextResponse.json(await reviewReportCommentary(body.componentId, body.decision, { note: body.note, approvedText: body.approvedText }, session));
      default:
        return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
