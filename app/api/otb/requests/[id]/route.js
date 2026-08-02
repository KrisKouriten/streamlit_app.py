import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../../lib/auth";
import { transitionMerchRequest, setRequestException, generatePoFromRequest } from "../../../../../lib/otb-procurement";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");
const canApprove = (s) => hasRole(s, "ADMIN", "FINANCE");

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "exception") return NextResponse.json(await setRequestException(id, { reason: body.reason }, session));
    if (body.op === "generate-po") return NextResponse.json(await generatePoFromRequest(id, session));
    if (body.op === "transition") {
      // Approving / rejecting a request is a finance/admin gate.
      if (["approve", "reject", "finance"].includes(body.action) && !canApprove(session)) {
        return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
      }
      return NextResponse.json(await transitionMerchRequest(id, body.action, session));
    }
    return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
