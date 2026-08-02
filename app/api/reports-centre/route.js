import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listReports, createReport } from "../../../lib/reporting/reports";
import { getUserDepartmentById, getReportPermissionsForDepartment } from "../../../lib/governance";
import { filterViewableReports } from "../../../lib/reporting/report-access-rules";

export const dynamic = "force-dynamic";

// List reports the caller may view. Finance/exec/admin see all; other departments
// see only the report templates their department has been granted (migration 064).
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const owner = url.searchParams.get("mine") ? (session.email || session.name) : null;
  const status = url.searchParams.get("status") || null;
  const r = await listReports({ owner, status });
  const department = await getUserDepartmentById(session.id);
  const permissions = await getReportPermissionsForDepartment(department);
  const reports = filterViewableReports(r.reports || r || [], { roles: session.roles, permissions });
  return NextResponse.json({ ...(Array.isArray(r) ? {} : r), reports });
}

// Create a report from a template. Finance/admin only.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Not authorised to create reports" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    const r = await createReport(body, session);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
