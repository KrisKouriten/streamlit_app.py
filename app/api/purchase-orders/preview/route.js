import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { computeSelfApprovalDecision } from "../../../../lib/purchase-orders";

export const dynamic = "force-dynamic";

// Live "Self-approval status" preview for a P.O being drafted — before it is saved.
// Returns the decision for a { department, value } so the requester sees, up front,
// whether the P.O will self-approve or route to sign-off, and why.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { decision, usage, policy } = await computeSelfApprovalDecision({
    department: body.department, value: body.value,
  });
  return NextResponse.json({ ok: true, decision, usage, hasPolicy: !!policy });
}
