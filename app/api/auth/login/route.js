import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { verifyPassword, createSessionToken, setSessionCookie } from "../../../../lib/auth";
import { getUserRoles, audit } from "../../../../lib/governance";

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
    }
    const { rows } = await query("SELECT id, email, name, password, is_active FROM users WHERE email = $1", [
      String(email).toLowerCase().trim(),
    ]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password))) {
      return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
    }
    if (user.is_active === false) {
      return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
    }
    const roles = await getUserRoles(user.id);
    const token = await createSessionToken(user, roles.length ? roles : ["FINANCE"]);
    await setSessionCookie(token);
    await audit({ actor: user, eventType: "auth.login", objectType: "users", objectRef: String(user.id) });
    return NextResponse.json({ id: user.id, name: user.name, email: user.email });
  } catch (e) {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
