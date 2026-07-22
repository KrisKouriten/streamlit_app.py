import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import {
  listVersions,
  createVersionFromCurrent,
  approveVersion,
  archiveVersion,
  deleteVersion,
  compareVersionsById,
} from "../../../lib/forecast-versions";

export const dynamic = "force-dynamic";

// GET: list versions (?kind=BUDGET|FORECAST), or diff two (?a=<id>&b=<id>).
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const a = searchParams.get("a"), b = searchParams.get("b");
  try {
    if (a && b) return NextResponse.json(await compareVersionsById(Number(a), Number(b)));
    const kind = searchParams.get("kind");
    return NextResponse.json(await listVersions({ kind: kind || null }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// POST: mutations. Snapshotting and lifecycle changes are ADMIN/FINANCE only.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Managing versions requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const { action } = body;
  try {
    if (action === "create") {
      const r = await createVersionFromCurrent(
        { label: body.label, kind: body.kind, fiscalYear: body.fiscalYear, notes: body.notes },
        session
      );
      return NextResponse.json({ ok: true, ...r });
    }
    if (action === "approve") {
      await approveVersion(Number(body.versionId), session);
      return NextResponse.json({ ok: true });
    }
    if (action === "archive") {
      await archiveVersion(Number(body.versionId), session);
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      await deleteVersion(Number(body.versionId), session);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
