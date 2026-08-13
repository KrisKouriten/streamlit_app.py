import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { upsertSupplier, setFacilityLimit, deleteSupplier, proposeSupplier } from "../../../lib/suppliers";

export const dynamic = "force-dynamic";

// Suppliers & credit. Branches on body.op:
//   "propose"        → proposeSupplier — any signed-in user may quick-add a supplier
//                      stub from a request form (Finance completes its details later)
//   "upsert"         → upsertSupplier (create / amend a supplier + its credit limit)  [Finance/Admin]
//   "facility-limit" → setFacilityLimit (the HSBC trade-facility ceiling)             [Finance/Admin]
//   "delete"         → deleteSupplier                                                 [Finance/Admin]
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    // Quick-add from a request form: open to any signed-in user. The supplier is
    // created as a stub for Finance to complete, so it is a low-privilege action.
    if (body.op === "propose") {
      const r = await proposeSupplier(body.name, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    // Everything below maintains the supplier master + facility — Finance/Admin only.
    if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Finance only" }, { status: 403 });
    if (body.op === "facility-limit") {
      const r = await setFacilityLimit(body, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.op === "delete") {
      const r = await deleteSupplier(body.id, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await upsertSupplier(body, actor);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
