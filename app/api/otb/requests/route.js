import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { listMerchRequests, createMerchRequest, requestAvailability } from "../../../../lib/otb-procurement";
import { resolveBaseUrl } from "../../../../lib/invite-rules";
import { notifyMerchRequestRaised } from "../../../../lib/workflow-notify";
import { CHANNEL_LABEL } from "../../../../lib/otb-rules";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

function baseUrlOf(request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin")
    || (host ? `${request.headers.get("x-forwarded-proto") || "https"}://${host}` : null);
  return resolveBaseUrl({ origin, env: process.env });
}

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const requests = await listMerchRequests({
    otbVersionId: url.searchParams.get("version") || null,
    channel: url.searchParams.get("channel") || null,
    status: url.searchParams.get("status") || null,
  });
  return NextResponse.json({ requests });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    // A preview of available OTB for the request being drafted.
    if (body.op === "availability") {
      return NextResponse.json({ ok: true, availability: await requestAvailability(body) });
    }
    const result = await createMerchRequest(body, session);
    // Ping the Finance/Ops reviewers that a new request is waiting (best-effort).
    try {
      await notifyMerchRequestRaised({
        request: {
          purchaseId: result.purchaseId,
          submitter: session.email || session.name,
          channel: CHANNEL_LABEL[body.channel_code] || body.channel_code,
          supplier: body.supplier,
          value: body.amount_gbp,
          period: body.otb_period,
          reason: body.reason,
        },
        baseUrl: baseUrlOf(request),
      });
    } catch (e) { console.error("merch request notify failed:", e.message); }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
