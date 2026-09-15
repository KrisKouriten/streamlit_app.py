import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { listCardSpend, addCardSpend, updateCardSpend, deleteCardSpend } from "../../../lib/card-spend";

export const dynamic = "force-dynamic";

// Card / pre-approved spend — any signed-in user may log/edit their department's
// card spend (no approval). Branches on body.op: "update" / "delete" / (default) add.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const budgetId = url.searchParams.get("budgetId") ? Number(url.searchParams.get("budgetId")) : null;
  const department = url.searchParams.get("department") || null;
  return NextResponse.json(await listCardSpend({ budgetId, department }));
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "update") return NextResponse.json(await updateCardSpend(body.card_id, body.patch || {}, session));
    if (body.op === "delete") return NextResponse.json(await deleteCardSpend(body.card_id, session));
    return NextResponse.json(await addCardSpend(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
