import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { upsertConsolidationAdjustment, setConsolidationAdjustmentApproval, deleteConsolidationAdjustment } from "../../../../lib/planning";

// Consolidation-adjustment mutations. Only APPROVED adjustments feed the
// Consolidated P&L's Adjustments column; approval is separated from entry.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Consolidation requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "saveAdjustment") {
      const r = await upsertConsolidationAdjustment({ ...body.adjustment, version_id: Number(body.versionId), scenario_code: body.scenario || "BASE" }, session);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "setApproval") {
      if (!body.adjId) return NextResponse.json({ error: "adjId required" }, { status: 400 });
      await setConsolidationAdjustmentApproval(Number(body.adjId), body.status, session);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "deleteAdjustment") {
      if (!body.adjId) return NextResponse.json({ error: "adjId required" }, { status: 400 });
      await deleteConsolidationAdjustment(Number(body.adjId), session);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("plan consolidation API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
