import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { listPos, createPo } from "../../../lib/purchase-orders";

export const dynamic = "force-dynamic";

// List purchase orders. ?mine=1 scopes to the caller. Any signed-in user.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const owner = url.searchParams.get("mine") ? (session.email || session.name) : null;
  const status = url.searchParams.get("status") || null;
  const department = url.searchParams.get("department") || null;
  const r = await listPos({ owner, status, department });
  return NextResponse.json(r);
}

// Create a P.O (department user). The header + optional recharge are validated
// in the data/rules layers.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const r = await createPo(body, session);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
