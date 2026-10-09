import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { upsertBusinessProject, upsertProjectCost, deleteProjectCost, deleteBusinessProject } from "../../../lib/business-projects";
import { audit } from "../../../lib/governance";

export const dynamic = "force-dynamic";

// Create or update a business project, or manage its planned cost lines. Any
// signed-in user (HO planning module). Branches on body.op:
//   "cost-upsert" → upsertProjectCost   "cost-delete" → deleteProjectCost
//   "delete"      → deleteBusinessProject (whoever set it up, or Finance /
//                   Admin; refused while P.Os or budgets point at it)
//   (default)     → upsertBusinessProject
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.op === "cost-upsert") {
      const r = await upsertProjectCost(body, actor);
      await audit({ actor, eventType: "business_project.cost.upsert", objectType: "business_project_cost", objectRef: String(r.id), detail: { business_project_id: body.business_project_id, department: body.department, amount: body.amount } });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.op === "cost-delete") {
      const r = await deleteProjectCost(body.cost_id, actor);
      await audit({ actor, eventType: "business_project.cost.delete", objectType: "business_project_cost", objectRef: String(body.cost_id) });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.op === "delete") {
      const r = await deleteBusinessProject(body.id, { actor, canManage: hasRole(session, "ADMIN", "FINANCE") });
      await audit({ actor, eventType: "business_project.delete", objectType: "business_project", objectRef: String(r.id), detail: { name: r.name, cost_lines: r.costLines } });
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await upsertBusinessProject(body, actor);
    await audit({ actor, eventType: "business_project.upsert", objectType: "business_project", objectRef: String(r.id), detail: { name: body.name, status: body.status } });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
