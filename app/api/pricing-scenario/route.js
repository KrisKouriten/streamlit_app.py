import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listScenarios, createScenario } from "../../../lib/pricing-scenario";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ scenarios: await listScenarios() });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await createScenario(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
