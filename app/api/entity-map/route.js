import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listEntityMap, upsertEntityMapping, deleteEntityMapping } from "../../../lib/joiin-entity-map";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";

// The Joiin company-name → id map. Read for any signed-in user; edits are
// ADMIN/FINANCE, since a wrong id silently breaks a company's refresh.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await listEntityMap());
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Editing the entity map requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "delete") {
      await deleteEntityMapping(body.entity_name);
      await audit({ actor: session, eventType: "entity_map.delete", objectType: "joiin_entity_map", objectRef: body.entity_name });
      return NextResponse.json({ ok: true });
    }
    await upsertEntityMapping(body);
    await audit({ actor: session, eventType: "entity_map.upsert", objectType: "joiin_entity_map", objectRef: body.entity_name, detail: { active: body.active } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
