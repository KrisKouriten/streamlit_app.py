import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getSession, isAdmin, hashPassword, endAllSessions } from "../../../../lib/auth";
import { audit, setUserRole, listUsersWithRoles } from "../../../../lib/governance";

const VALID_ROLES = ["ADMIN", "EXEC", "FINANCE", "OPS", "FRANCHISEE"];

function forbidden() {
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdmin(session)) return forbidden();
  return NextResponse.json({ users: await listUsersWithRoles() });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdmin(session)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const action = body.action;

  try {
    if (action === "create") {
      const { name, email, password, role } = body;
      if (!name?.trim() || !email?.includes("@") || !password || password.length < 8 || !VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: "Need name, valid email, password (8+ chars) and a valid role" }, { status: 400 });
      }
      const hash = await hashPassword(password);
      const { rows } = await query(
        `INSERT INTO users (email, name, password) VALUES (lower($1), $2, $3)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [email.trim(), name.trim(), hash]
      );
      if (!rows.length) return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
      await setUserRole(rows[0].id, role, session.email);
      await query(`INSERT INTO workflow.team_capacity (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [rows[0].id]).catch(() => {});
      await audit({ actor: session, eventType: "user.create", objectType: "users", objectRef: email.trim().toLowerCase(), detail: { role } });
      return NextResponse.json({ ok: true });
    }

    if (action === "set-role") {
      const { userId, role } = body;
      if (!Number.isInteger(userId) || !VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: "Invalid user or role" }, { status: 400 });
      }
      if (userId === session.id && role !== "ADMIN") {
        return NextResponse.json({ error: "You cannot remove your own admin role" }, { status: 400 });
      }
      await setUserRole(userId, role, session.email);
      await audit({ actor: session, eventType: "user.set-role", objectType: "users", objectRef: String(userId), detail: { role } });
      return NextResponse.json({ ok: true });
    }

    if (action === "reset-password") {
      const { userId, password } = body;
      if (!Number.isInteger(userId) || !password || password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      const hash = await hashPassword(password);
      await query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, userId]);
      // A password reset invalidates every existing session for that user.
      await endAllSessions(userId, session.email);
      await audit({ actor: session, eventType: "user.reset-password", objectType: "users", objectRef: String(userId) });
      return NextResponse.json({ ok: true });
    }

    if (action === "set-active") {
      const { userId, isActive } = body;
      if (!Number.isInteger(userId) || typeof isActive !== "boolean") {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      if (userId === session.id && !isActive) {
        return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 400 });
      }
      await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, userId]);
      // Deactivating an account tears down its live sessions immediately.
      if (!isActive) await endAllSessions(userId, session.email);
      await audit({ actor: session, eventType: "user.set-active", objectType: "users", objectRef: String(userId), detail: { isActive } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("admin/users error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
