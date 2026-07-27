import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { createReport, addAdhocSection, addComponent } from "../../../../lib/reporting/reports";

export const dynamic = "force-dynamic";

/*
 * "Add to Report" (CR §8) — add a chart / KPI / table / commentary from a
 * dashboard into an existing draft or a new report. The source key + current
 * filters are saved so the item refreshes from governed data (never a
 * screenshot). Returns the target reportId + sectionInstId.
 */
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    let reportId = body.reportId || null;
    if (!reportId) {
      const created = await createReport({
        templateKey: body.templateKey || "WEEKLY_TRADE_PACK",
        title: body.newTitle || "New report",
        reportingPeriod: body.reportingPeriod || new Date().toISOString().slice(0, 7),
      }, session);
      reportId = created.reportId;
    }
    const { sectionInstId } = await addAdhocSection(reportId, {
      title: body.sectionTitle || "Added from dashboard",
      sourceKey: body.sourceKey || null,
      filters: body.filters || {},
      pageType: "content",
      aiPerspective: body.aiPerspective || null,
    }, session);
    await addComponent(reportId, sectionInstId, {
      component_type: body.componentType || "table",
      title: body.sectionTitle || null,
      source_key: body.sourceKey || null,
      filters: body.filters || {},
      config: { addedFrom: body.sourceRoute || null, includeSourceLink: body.includeSourceLink !== false },
    }, session);
    return NextResponse.json({ ok: true, reportId, sectionInstId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
