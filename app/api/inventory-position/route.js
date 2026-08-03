import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { saveInventoryPosition, deleteInventoryPosition, ingestInventoryPositions } from "../../../lib/inventory-position";

// Inventory Position master — save / delete a position, or bulk-ingest a CSV.
// Managed by Finance, Merchandising Ops and admins.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE", "OPS")) {
    return NextResponse.json({ error: "Inventory entry requires ADMIN, FINANCE or OPS" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "save": return NextResponse.json(await saveInventoryPosition(body.row || {}, session));
      case "delete": return NextResponse.json(await deleteInventoryPosition(body.id, session));
      case "ingest":
        if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
        return NextResponse.json(await ingestInventoryPositions(body.csv, session));
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("inventory-position API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
