import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestTop80Workbook } from "../../../lib/sku-report";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Upload a distributed SKU analysis workbook (ADMIN/FINANCE). action: "top80".
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Uploading requires ADMIN or FINANCE" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  if (!body.file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const buffer = Buffer.from(body.file, "base64");
  const actor = session.email || session.name;
  try {
    if (body.action === "top80") {
      const r = await ingestTop80Workbook(buffer, actor);
      await audit({ actor, eventType: "sku.upload", objectType: "sku_analysis", objectRef: "top80", detail: r });
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
