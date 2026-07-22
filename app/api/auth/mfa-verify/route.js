import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getMfaPending, startSession, setSessionCookie, clearMfaPendingCookie } from "../../../../lib/auth";
import { verifyForLogin } from "../../../../lib/mfa";
import { getUserRoles, audit } from "../../../../lib/governance";

export const dynamic = "force-dynamic";

// Second factor at sign-in. Requires the short-lived pending ticket set by the
// login route (so the password step cannot be skipped). On a good code, mint the
// real session. Public in the middleware because there is no full session yet.
export async function POST(request) {
  const pending = await getMfaPending();
  if (!pending) {
    return NextResponse.json({ error: "Your sign-in timed out — please enter your email and password again" }, { status: 401 });
  }

  const { code } = await request.json().catch(() => ({}));
  if (!code) return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app" }, { status: 400 });

  const result = await verifyForLogin(pending.uid, code);
  if (!result.ok) {
    if (result.locked) {
      return NextResponse.json({ error: "Too many attempts — two-step is locked for a few minutes. Try again shortly." }, { status: 429 });
    }
    return NextResponse.json({ error: "That code didn't match — try again, or use a recovery code" }, { status: 401 });
  }

  // Load the live account, re-checking it is still active before issuing a session.
  const { rows } = await query("SELECT id, email, name, is_active FROM users WHERE id = $1", [pending.uid]);
  const user = rows[0];
  if (!user || user.is_active === false) {
    clearMfaPendingCookie();
    return NextResponse.json({ error: "This account is not available" }, { status: 403 });
  }

  const roles = await getUserRoles(user.id);
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const userAgent = request.headers.get("user-agent") || null;
  const token = await startSession(user, roles.length ? roles : ["FINANCE"], { ip, userAgent });
  await setSessionCookie(token);
  clearMfaPendingCookie();
  await audit({ actor: user, eventType: "auth.login", objectType: "users", objectRef: String(user.id), detail: { mfa: result.method } });
  return NextResponse.json({ id: user.id, name: user.name, email: user.email });
}
