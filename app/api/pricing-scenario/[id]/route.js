import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { getScenario, addSkusToScenario, saveScenarioLine, deleteScenarioLine, setScenarioStatus } from "../../../../lib/pricing-scenario";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");
const canApprove = (s) => hasRole(s, "ADMIN", "FINANCE");

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const data = await getScenario(id);
  if (!data) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "add-skus": return NextResponse.json(await addSkusToScenario(id, body.selections || [], session));
      case "save-line": return NextResponse.json(await saveScenarioLine(body.lineId, body.patch || {}, session));
      case "delete-line": return NextResponse.json(await deleteScenarioLine(body.lineId, session));
      case "status": {
        if (["approve", "reopen"].includes(body.action) && !canApprove(session)) return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
        return NextResponse.json(await setScenarioStatus(id, body.action, session));
      }
      default: return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
