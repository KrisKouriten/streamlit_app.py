import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listReports, createReport } from "../../../lib/reporting/reports";

export const dynamic = "force-dynamic";

// List reports. Any finance/exec user may view; ?mine=1 scopes to the caller.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const url = new URL(request.url);
  const owner = url.searchParams.get("mine") ? (session.email || session.name) : null;
  const status = url.searchParams.get("status") || null;
  const r = await listReports({ owner, status });
  return NextResponse.json(r);
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
