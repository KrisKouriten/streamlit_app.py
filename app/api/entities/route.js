import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { createEntity, updateEntity, ENTITY_TYPES } from "../../../lib/entities";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Managing entities requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "create") {
      const code = (body.code || "").trim().toUpperCase();
      const name = (body.name || "").trim();
      if (!code || !name) return NextResponse.json({ error: "An entity needs a code and a display name" }, { status: 400 });
      if (body.type && !ENTITY_TYPES.includes(body.type)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      const id = await createEntity({ code, name, legalName: body.legalName?.trim(), type: body.type }, session);
      return NextResponse.json({ ok: true, entityId: id });
    }
    if (body.action === "update") {
      if (!body.entityId) return NextResponse.json({ error: "Missing entity" }, { status: 400 });
      if (!body.name?.trim()) return NextResponse.json({ error: "Display name is required" }, { status: 400 });
      if (body.type && !ENTITY_TYPES.includes(body.type)) return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      await updateEntity(Number(body.entityId), {
        name: body.name.trim(), legalName: body.legalName?.trim(), type: body.type, isActive: body.isActive,
      }, session);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (/unique|duplicate/i.test(e.message)) return NextResponse.json({ error: "That entity code is already in use" }, { status: 409 });
    console.error("entities API error:", e.message);
    return NextResponse.json({ error: "Could not save the entity" }, { status: 500 });
  }
}
