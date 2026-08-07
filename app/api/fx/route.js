import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { getFxRates, setFxRate } from "../../../lib/fx";

export const dynamic = "force-dynamic";
const isFinance = (s) => hasRole(s, "ADMIN", "FINANCE");

// Read the FX rate table (anyone signed in) / set a rate (Finance or admin).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ ok: true, rates: await getFxRates() });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isFinance(session)) return NextResponse.json({ error: "Setting exchange rates requires the FINANCE or ADMIN role" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "set-fx-rate") return NextResponse.json(await setFxRate(body, actor));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
