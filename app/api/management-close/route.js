import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { reviewException, toggleCloseAction, ingestExpectations } from "../../../lib/preclose";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Management close actions require ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "toggle") {
      if (!body.actionId || !body.period) return NextResponse.json({ error: "actionId and period required" }, { status: 400 });
      await toggleCloseAction({ actionId: body.actionId, period: body.period, done: !!body.done, actor });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "review") {
      const { period, accountCode, check, status, note } = body;
      if (!period || !accountCode || !check || !["CONFIRMED", "EXPLAINED", "CORRECTING"].includes(status)) {
        return NextResponse.json({ error: "period, accountCode, check and a valid status are required" }, { status: 400 });
      }
      await reviewException({ period, accountCode, check, status, note, actor });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "model") {
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const r = await ingestExpectations(body.csv, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("management-close API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
