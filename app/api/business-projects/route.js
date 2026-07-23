import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { upsertBusinessProject } from "../../../lib/business-projects";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";

// Create or update a business project. Any signed-in user (HO planning module).
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    const r = await upsertBusinessProject(body, actor);
    await audit({ actor, eventType: "business_project.upsert", objectType: "business_project", objectRef: String(r.id), detail: { name: body.name, status: body.status } });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
