import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { getProject, upsertProject, deleteProject } from "../../../../lib/capex";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "EXEC");

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "delete") return NextResponse.json(await deleteProject(id, session));
    return NextResponse.json(await upsertProject({ ...body.patch, project_id: id }, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
