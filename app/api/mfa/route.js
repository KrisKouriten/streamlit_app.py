import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { beginEnrolment, confirmEnrolment, disableMfa, regenerateRecovery, getMfaStatus } from "../../../lib/mfa";

export const dynamic = "force-dynamic";

// Self-service two-step management for the signed-in user. Everything here acts
// only on the caller's own account (session.id) — never another user's.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action, code } = body;
  try {
    if (action === "begin") {
      const { secret, otpauth } = await beginEnrolment(session.id, session.email, session);
      return NextResponse.json({ ok: true, secret, otpauth });
    }
    if (action === "confirm") {
      const { recoveryCodes } = await confirmEnrolment(session.id, code, session);
      return NextResponse.json({ ok: true, recoveryCodes });
    }
    if (action === "disable") {
      await disableMfa(session.id, code, session);
      return NextResponse.json({ ok: true });
    }
    if (action === "recovery-regenerate") {
      const { recoveryCodes } = await regenerateRecovery(session.id, code, session);
      return NextResponse.json({ ok: true, recoveryCodes });
    }
    if (action === "status") {
      return NextResponse.json(await getMfaStatus(session.id));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
