import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { listMiscSpend, addMiscSpend, updateMiscSpend, deleteMiscSpend } from "../../../lib/misc-spend";

export const dynamic = "force-dynamic";

// Miscellaneous spend — any signed-in user may log/edit their department's small
// spend (no approval). Branches on body.op: "update" / "delete" / (default) add.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const budgetId = url.searchParams.get("budgetId") ? Number(url.searchParams.get("budgetId")) : null;
  const department = url.searchParams.get("department") || null;
  return NextResponse.json(await listMiscSpend({ budgetId, department }));
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "update") return NextResponse.json(await updateMiscSpend(body.misc_id, body.patch || {}, session));
    if (body.op === "delete") return NextResponse.json(await deleteMiscSpend(body.misc_id, session));
    return NextResponse.json(await addMiscSpend(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
