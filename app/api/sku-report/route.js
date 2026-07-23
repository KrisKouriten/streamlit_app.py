import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestTop80, ingestTop80Workbook, ingestNewSku, ingestDormant } from "../../../lib/sku-report";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Upload a distributed SKU analysis workbook (ADMIN/FINANCE). action: "top80".
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Uploading requires ADMIN or FINANCE" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "top80") {
      // Preferred: browser-parsed sheet map (small). Fallback: raw base64 file.
      const r = body.sheets ? await ingestTop80(body.sheets, actor)
        : body.file ? await ingestTop80Workbook(Buffer.from(body.file, "base64"), actor)
          : null;
      if (!r) return NextResponse.json({ error: "No workbook provided" }, { status: 400 });
      await audit({ actor, eventType: "sku.upload", objectType: "sku_analysis", objectRef: "top80", detail: r });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "newsku") {
      if (!body.sheets) return NextResponse.json({ error: "No workbook provided" }, { status: 400 });
      const r = await ingestNewSku(body.sheets, actor);
      await audit({ actor, eventType: "sku.upload", objectType: "sku_analysis", objectRef: "newsku", detail: r });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "dormant") {
      if (!body.sheets) return NextResponse.json({ error: "No workbook provided" }, { status: 400 });
      const r = await ingestDormant(body.sheets, actor);
      await audit({ actor, eventType: "sku.upload", objectType: "sku_analysis", objectRef: "dormant", detail: r });
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
