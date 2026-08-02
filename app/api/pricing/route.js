import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listSkuPrices, upsertSkuPrice, ingestPricingCsv, pricingDashboard } from "../../../lib/pricing";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const filters = {
    channel: url.searchParams.get("channel") || null,
    category: url.searchParams.get("category") || null,
    status: url.searchParams.get("status") || null,
    search: url.searchParams.get("q") || null,
  };
  const [skus, dashboard] = await Promise.all([listSkuPrices(filters), pricingDashboard({ channel: filters.channel })]);
  return NextResponse.json({ skus, dashboard });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "ingest") return NextResponse.json(await ingestPricingCsv(body.csv || "", session));
    return NextResponse.json(await upsertSkuPrice(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
