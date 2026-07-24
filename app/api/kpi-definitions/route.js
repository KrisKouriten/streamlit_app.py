import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { createKpi, updateKpi } from "../../../lib/kpi";

export const dynamic = "force-dynamic";

// Master the KPI catalogue (intelligence.dim_kpi). ADMIN/FINANCE only; every
// change is audited in the lib layer.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Mastering KPIs requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;

  try {
    if (body.action === "create") {
      if (!body.code?.trim()) return NextResponse.json({ error: "A KPI code is required" }, { status: 400 });
      if (!body.name?.trim()) return NextResponse.json({ error: "A KPI name is required" }, { status: 400 });
      const id = await createKpi({ ...body, code: body.code.trim(), name: body.name.trim() }, actor);
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "update") {
      if (!body.kpiId) return NextResponse.json({ error: "kpiId is required" }, { status: 400 });
      if (!body.name?.trim()) return NextResponse.json({ error: "A KPI name is required" }, { status: 400 });
      await updateKpi(Number(body.kpiId), { ...body, name: body.name.trim() }, actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e?.code === "23505") return NextResponse.json({ error: "That KPI code already exists" }, { status: 409 });
    console.error("kpi-definitions POST error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
