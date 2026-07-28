import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getPo, updatePo, submitForSignoff, returnToDraft } from "../../../../lib/purchase-orders";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const po = await getPo(id);
  if (!po) return NextResponse.json({ error: "P.O not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...po });
}

// Mutating operations. `op` selects the action.
export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "update":
        return NextResponse.json(await updatePo(id, body.patch || {}, session));
      case "submit":
        return NextResponse.json(await submitForSignoff(id, session));
      case "return":
        return NextResponse.json(await returnToDraft(id, session));
      default:
        return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
