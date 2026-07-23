import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestActualsWorkbook } from "../../../lib/management-accounts";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Uploading actuals requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "workbook") {
      if (!body.file) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      const r = await ingestActualsWorkbook(Buffer.from(body.file, "base64"), actor);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("management-accounts API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
