import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { getSkuPrice, upsertSkuPrice, deleteSkuPrice } from "../../../../lib/pricing";
import { whatIf, priceForTargetGp, computeCostBuild } from "../../../../lib/pricing-rules";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const sku = await getSkuPrice(id);
  if (!sku) return NextResponse.json({ error: "SKU not found" }, { status: 404 });
  return NextResponse.json({ ok: true, sku });
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "delete") return NextResponse.json(await deleteSkuPrice(id, session));
    // What-if / target-price analysis on the saved SKU (no write).
    if (body.op === "whatif") {
      const sku = await getSkuPrice(id);
      if (!sku) return NextResponse.json({ error: "SKU not found" }, { status: 404 });
      const result = whatIf(sku, body.overrides || {});
      const target = body.targetGpPct != null
        ? priceForTargetGp(computeCostBuild(sku).totalCost, body.targetGpPct, sku.retail_vat_pct) : null;
      return NextResponse.json({ ok: true, result, target });
    }
    // Update (upsert by sku_code + channel).
    return NextResponse.json(await upsertSkuPrice({ ...body.patch, sku_code: body.patch?.sku_code, channel_code: body.patch?.channel_code }, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
