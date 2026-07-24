import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getSession, verifyPassword, hashPassword, endOtherSessions } from "../../../../lib/auth";
import { validatePasswordChange } from "../../../../lib/password-rules";
import { audit } from "../../../../lib/governance";

/*
 * Self-service password change for the signed-in user. Unlike the admin
 * reset (which is a privileged override), this proves the current password
 * before setting a new one. On success every OTHER session is revoked — the
 * current one stays live — so a changed password takes hold everywhere else.
 */
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const current = body.current;
  const next = body.next;
  const confirm = body.confirm;

  const check = validatePasswordChange({ current, next, confirm });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const { rows } = await query("SELECT password FROM users WHERE id = $1", [session.id]);
    const user = rows[0];
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (!(await verifyPassword(current, user.password))) {
      await audit({ actor: session, eventType: "auth.change-password.failed", objectType: "users", objectRef: String(session.id) });
      return NextResponse.json({ error: "Your current password is incorrect" }, { status: 400 });
    }

    const hash = await hashPassword(next);
    await query("UPDATE users SET password = $1 WHERE id = $2", [hash, session.id]);

    // Keep this session; drop the rest so other devices must re-authenticate.
    let signedOut = 0;
    try { signedOut = await endOtherSessions(session.id, session.sid, session.email); } catch {}

    await audit({ actor: session, eventType: "auth.change-password", objectType: "users", objectRef: String(session.id), detail: { otherSessionsEnded: signedOut } });
    return NextResponse.json({ ok: true, otherSessionsEnded: signedOut });
  } catch (e) {
    console.error("account/password error:", e.message);
    return NextResponse.json({ error: "Could not change your password. Try again." }, { status: 500 });
  }
}
