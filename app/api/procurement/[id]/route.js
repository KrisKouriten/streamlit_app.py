import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { getProcurementLine, approveProcurement, setInvoice, setPaymentStatus, challengeProcurement, closeProcurement, reopenFinance, setLc, reconcileLc } from "../../../../lib/procurement-close";

export const dynamic = "force-dynamic";
const isFinance = (s) => hasRole(s, "ADMIN", "FINANCE");

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const line = await getProcurementLine(id);
  if (!line) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  return NextResponse.json({ ok: true, line });
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isFinance(session)) return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "approve": return NextResponse.json(await approveProcurement(id, session));
      case "set-invoice": return NextResponse.json(await setInvoice(id, body, session));
      case "set-payment-status": return NextResponse.json(await setPaymentStatus(id, body, session));
      case "challenge": return NextResponse.json(await challengeProcurement(id, body, session));
      case "close": return NextResponse.json(await closeProcurement(id, body, session));
      case "set-lc": return NextResponse.json(await setLc(id, body, session));
      case "reconcile-lc": return NextResponse.json(await reconcileLc(id, body, session));
      case "reopen-finance": return NextResponse.json(await reopenFinance(id, session));
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
