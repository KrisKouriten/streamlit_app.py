import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { captureRecommendation, recordMeasurement } from "../../../../lib/intelligence/benefit";

export const dynamic = "force-dynamic";

/*
 * Benefit measurement for the intelligence layer.
 *   op="capture"  → turn an AI recommendation into a tracked opportunity
 *   op="measure"  → record a realised value against one
 * ADMIN/FINANCE only. Finance validation stays on Govern › Benefits.
 */
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Benefit tracking requires ADMIN or FINANCE" }, { status: 403 });
  }
  const b = await request.json().catch(() => ({}));

  if (b.op === "measure") {
    if (!b.opportunityId || b.value == null) return NextResponse.json({ error: "opportunityId and value are required" }, { status: 400 });
    const r = await recordMeasurement(Number(b.opportunityId), b.value, b.note || null, session);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  // default: capture
  const r = await captureRecommendation({
    actor: session, title: b.title, description: b.description || null,
    expectedValueGbp: b.expectedValueGbp ?? null, category: b.category || null,
    runId: b.runId ? Number(b.runId) : null, originSurface: b.originSurface || null,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
