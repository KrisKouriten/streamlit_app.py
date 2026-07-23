import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { createTxn, ingestCsv, toggleRecon, CATEGORIES } from "../../../lib/intercompany";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Intercompany changes require ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "create") {
      await createTxn(body, session);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "upload") {
      if (!CATEGORIES[body.category]) return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const result = await ingestCsv(body.category, body.csv, session);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "recon") {
      await toggleRecon(Number(body.txnId), body.flag, body.value, session);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("intercompany API error:", e.message);
    return NextResponse.json({ error: e.message || "Could not complete the action" }, { status: 400 });
  }
}
