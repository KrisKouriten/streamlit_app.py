import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import {
  saveTermLoan, deleteTermLoan, saveHedge, deleteHedge, saveSalesIncome, saveCashRecon, uploadTradeFacility,
} from "../../../lib/treasury";

// Treasury desk mutations — term loans, hedging contracts, sales income and store
// cash reconciliations. The bank trade facility is a seeded read-only register.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Treasury entry requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "save-loan": return NextResponse.json(await saveTermLoan(body.row || {}, session));
      case "delete-loan": return NextResponse.json(await deleteTermLoan(body.id, session));
      case "save-hedge": return NextResponse.json(await saveHedge(body.row || {}, session));
      case "delete-hedge": return NextResponse.json(await deleteHedge(body.id, session));
      case "save-sales": return NextResponse.json(await saveSalesIncome(body.row || {}, session));
      case "save-recon": return NextResponse.json(await saveCashRecon(body.row || {}, session));
      case "upload-facility": {
        if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
        return NextResponse.json(await uploadTradeFacility(body.csv, session));
      }
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("treasury API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
