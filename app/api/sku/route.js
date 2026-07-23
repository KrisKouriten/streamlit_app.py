import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestSkuCsv } from "../../../lib/sku";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Loading SKU data requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "upload") {
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const r = await ingestSkuCsv(body.csv, session.email || session.name);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("sku API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
