import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { generateCommentary } from "../../../../lib/intelligence/commentary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Draft a piece of commentary. ADMIN/FINANCE only — it is a governed generation.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Drafting commentary requires ADMIN or FINANCE" }, { status: 403 });
  }
  const { subject, scopeRef } = await request.json().catch(() => ({}));
  if (!subject) return NextResponse.json({ error: "subject is required" }, { status: 400 });
  const result = await generateCommentary({ actor: session, subject, scopeRef: scopeRef || null });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
