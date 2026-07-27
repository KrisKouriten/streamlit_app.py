import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../../lib/auth";
import { reviewCommentary } from "../../../../../lib/intelligence/commentary";

export const dynamic = "force-dynamic";

// Approve or reject a drafted piece of commentary (human sign-off).
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) {
    return NextResponse.json({ error: "Signing off commentary requires ADMIN, FINANCE or EXEC" }, { status: 403 });
  }
  const { commentaryId, decision, note } = await request.json().catch(() => ({}));
  if (!commentaryId || !["APPROVED", "REJECTED"].includes(decision)) {
    return NextResponse.json({ error: "commentaryId and decision (APPROVED|REJECTED) are required" }, { status: 400 });
  }
  const result = await reviewCommentary(Number(commentaryId), decision, note || null, session);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
