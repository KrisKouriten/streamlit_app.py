import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { upsertSupplier, setFacilityLimit } from "../../../lib/suppliers";

export const dynamic = "force-dynamic";

// Suppliers & credit — Finance/Admin only. Branches on body.op:
//   "upsert"         → upsertSupplier (create / amend a supplier + its credit limit)
//   "facility-limit" → setFacilityLimit (the HSBC trade-facility ceiling)
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Finance only" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.op === "facility-limit") {
      const r = await setFacilityLimit(body, actor);
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await upsertSupplier(body, actor);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
