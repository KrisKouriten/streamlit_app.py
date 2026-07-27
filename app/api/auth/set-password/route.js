import { NextResponse } from "next/server";
import { hashPassword, endAllSessions } from "../../../../lib/auth";
import { redeemInvite, findInvite } from "../../../../lib/invite";
import { validateNewPassword, inviteProblemMessage } from "../../../../lib/invite-rules";
import { audit } from "../../../../lib/governance";

/*
 * Public endpoint that backs the /set-password page. It is reachable without a
 * session (the user has no way in yet) and is self-guarding: the one-time
 * token IS the authorisation. No session cookie is issued here — the user sets
 * a password and then signs in normally, which keeps the MFA gate intact for
 * enrolled accounts.
 *
 *  GET  ?token=…    check a link without spending it (page render): { valid, name }
 *  POST { token, password, confirm }   set the password, spend the token
 */

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  const found = await findInvite(token);
  if (!found.valid) {
    return NextResponse.json({ valid: false, error: inviteProblemMessage(found.reason) }, { status: 400 });
  }
  return NextResponse.json({ valid: true, name: found.invite.name, purpose: found.invite.purpose });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { token, password, confirm } = body;

  const check = validateNewPassword({ next: password, confirm });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const hash = await hashPassword(password);
    const result = await redeemInvite({ rawToken: token, passwordHash: hash });
    if (!result.ok) {
      return NextResponse.json({ error: inviteProblemMessage(result.reason) }, { status: 400 });
    }

    // Clean slate: drop any lingering sessions for the account (there normally
    // are none for a brand-new invite, but a reset should log other devices out).
    try { await endAllSessions(result.userId, "set-password"); } catch {}

    await audit({
      actor: { id: result.userId, email: result.email },
      eventType: result.purpose === "RESET" ? "auth.set-password.reset" : "auth.set-password.invite",
      objectType: "users",
      objectRef: String(result.userId),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("set-password error:", e.message);
    return NextResponse.json({ error: "Could not set your password. Try again." }, { status: 500 });
  }
}
