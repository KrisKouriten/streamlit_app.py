import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { listMerchRequests, createMerchRequest, requestAvailability } from "../../../../lib/otb-procurement";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

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
    // A new request starts as a draft; the head-of-department sign-off is pinged
    // when the merchandiser submits it (see the [id] transition route), and Finance
    // only once the head of department has approved.
    const result = await createMerchRequest(body, session);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
