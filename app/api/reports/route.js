import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listReports, createReport, updateReport, deleteReport } from "../../../lib/report-store";
import { DATASETS, DATASET_KEYS } from "../../../lib/report-datasets";

export const dynamic = "force-dynamic";

/*
 * Report Builder API. GET → saved reports + the dataset catalogue. POST →
 * create / update / delete a saved report (ADMIN/FINANCE). Export is a separate
 * GET at /api/reports/[id]/export.
 */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const reports = await listReports();
    return NextResponse.json({ reports, datasets: DATASETS });
  } catch (e) {
    console.error("reports GET error:", e.message);
    return NextResponse.json({ error: "Could not load reports" }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Managing reports requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;

  try {
    if (body.action === "create") {
      if (!body.name?.trim()) return NextResponse.json({ error: "A report name is required" }, { status: 400 });
      if (!DATASET_KEYS.has(body.datasetKey)) return NextResponse.json({ error: "Unknown dataset" }, { status: 400 });
      const id = await createReport({ name: body.name.trim(), datasetKey: body.datasetKey, params: body.params || {}, actor });
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await updateReport({ id: Number(body.id), name: body.name?.trim() || null, params: body.params || null, actor });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await deleteReport(Number(body.id), actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("reports POST error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
