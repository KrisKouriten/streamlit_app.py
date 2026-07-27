import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getSession, verifyPassword, hashPassword, endAllSessions, startSession, setSessionCookie } from "../../../../lib/auth";
import { validateNewPassword } from "../../../../lib/invite-rules";
import { audit } from "../../../../lib/governance";

/*
 * Forced first-sign-in password change. Backs the /change-password screen that
 * a user is diverted to when their session carries the mustChange flag (an
 * admin issued them a starter password). Unlike the self-service change, there
 * is no "current password" field — they proved it moments ago at sign-in — but
 * the new password must actually differ from the starter one.
 *
 * On success: the starter password is replaced, must_change_password is
 * cleared, every session (including this mustChange one) is revoked, and a
 * fresh clean session is issued so the middleware stops diverting them.
 */
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!session.mustChange) return NextResponse.json({ error: "No password change is required" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const check = validateNewPassword({ next: body.password, confirm: body.confirm });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const { rows } = await query("SELECT id, name, email, password FROM users WHERE id = $1", [session.id]);
    const user = rows[0];
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    // Must be a genuine change, not the starter password re-entered.
    if (await verifyPassword(body.password, user.password)) {
      return NextResponse.json({ error: "Please choose a password different from your temporary one" }, { status: 400 });
    }

    const hash = await hashPassword(body.password);
    await query("UPDATE users SET password = $1, must_change_password = false WHERE id = $2", [hash, user.id]);

    // Drop every session (this mustChange one included), then mint a fresh,
    // clean one so they land in the app without re-authenticating.
    await endAllSessions(user.id, session.email);
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const userAgent = request.headers.get("user-agent") || null;
    const token = await startSession(user, session.roles, { ip, userAgent }, { mustChange: false });
    await setSessionCookie(token);

    await audit({ actor: session, eventType: "auth.first-password", objectType: "users", objectRef: String(user.id) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("first-password error:", e.message);
    return NextResponse.json({ error: "Could not set your password. Try again." }, { status: 500 });
  }
}
