import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { uploadSalesForecast, setLiveSalesForecast, deleteSalesForecast, listSalesForecastVersions, getSalesForecastVersion } from "../../../lib/sales-forecast";

export const dynamic = "force-dynamic";
// A version is ~90,000 store-days, loaded in one transaction.
export const maxDuration = 60;

// GET: the version list, or one version's figures (?id=).
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  try {
    if (id) return NextResponse.json({ ok: true, ...(await getSalesForecastVersion(id)) });
    return NextResponse.json({ ok: true, ...(await listSalesForecastVersions()) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// POST: upload a version, make one live, or delete one. Finance / admin only.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "The sales forecast is managed by Finance" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "upload") {
      if (!body.file) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      return NextResponse.json(await uploadSalesForecast(Buffer.from(body.file, "base64"), { filename: body.filename || "", label: body.label || "" }, session));
    }
    if (body.action === "live") return NextResponse.json(await setLiveSalesForecast(Number(body.id), session));
    if (body.action === "delete") return NextResponse.json(await deleteSalesForecast(Number(body.id), session));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("sales-forecast API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
