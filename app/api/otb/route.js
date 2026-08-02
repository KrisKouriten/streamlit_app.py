import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listOtbVersions, createOtbVersion, listChannels } from "../../../lib/otb";

export const dynamic = "force-dynamic";

const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [versions, channels] = await Promise.all([listOtbVersions(), listChannels()]);
  return NextResponse.json({ versions, channels });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (!body.label) return NextResponse.json({ error: "Give the OTB version a label" }, { status: 400 });
    return NextResponse.json(await createOtbVersion(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
