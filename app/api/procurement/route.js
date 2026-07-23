import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestProcurementCsv, setBudget } from "../../../lib/procurement";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "OPS")) {
    return NextResponse.json({ error: "Procurement entry requires ADMIN, FINANCE or OPS" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "upload") {
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const r = await ingestProcurementCsv(body.csv, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "budget") {
      const { source, ym, budget } = body;
      if (!["MINISO", "LOCAL"].includes(source) || !/^\d{4}-\d{2}$/.test(ym || "") || !Number.isFinite(Number(budget))) {
        return NextResponse.json({ error: "source, month (YYYY-MM) and a numeric budget are required" }, { status: 400 });
      }
      await setBudget({ source, ym, budget: Number(budget) }, actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("procurement API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
