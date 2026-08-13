import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { query } from "../../../../lib/db";
import { getSession, isAdmin, hashPassword, endAllSessions } from "../../../../lib/auth";
import { clearMfaForUser } from "../../../../lib/mfa";
import { audit, setUserRole, setUserDepartment, listUsersWithRoles, addSignoff, removeSignoff, setNavVisibility, setAppSetting, listDepartments, listDeptPoPolicies, upsertDeptPoPolicy, listReportPermissions, setReportPermission } from "../../../../lib/governance";
import { validateDeptPoPolicy } from "../../../../lib/po-rules";
import { listTemplates } from "../../../../lib/reporting/templates";
import { createInvite } from "../../../../lib/invite";
import { resolveBaseUrl, setPasswordLink, INVITE_TTL_HOURS } from "../../../../lib/invite-rules";
import { emailConfigured, sendMail } from "../../../../lib/email/resend";
import { inviteEmail, resetEmail } from "../../../../lib/email/templates";

const VALID_ROLES = ["ADMIN", "EXEC", "FINANCE", "OPS", "FRANCHISEE"];

function forbidden() {
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

// Best-effort public origin for building the emailed link. The CSRF gate in
// middleware guarantees a same-origin Origin header on these POSTs, so it is
// the most reliable source; fall back to forwarded host, then env.
function requestOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : null;
}

/*
 * Generate a link for a user and try to email it. Returns what the admin UI
 * needs to react: whether the email went out, and — only when it did NOT — the
 * raw link so the admin can pass it on manually. We never hand the link back
 * when the email succeeded, so the token stays out of the admin's screen.
 */
async function deliverLink({ request, user, purpose, actor }) {
  const { rawToken, ttlHours } = await createInvite({
    userId: user.id,
    purpose,
    createdBy: actor.email,
  });
  const baseUrl = resolveBaseUrl({ origin: requestOrigin(request), env: process.env });
  const link = setPasswordLink(baseUrl, rawToken);
  const msg =
    purpose === "RESET"
      ? resetEmail({ name: user.name, link, expiresHours: ttlHours })
      : inviteEmail({ name: user.name, link, expiresHours: ttlHours, inviterName: actor.name });

  if (!emailConfigured()) {
    return { emailSent: false, reason: "not-configured", link };
  }
  try {
    await sendMail({ to: user.email, subject: msg.subject, html: msg.html, text: msg.text });
    return { emailSent: true, link: null };
  } catch (e) {
    console.error("invite email failed:", e.message);
    return { emailSent: false, reason: "send-failed", link, error: e.message };
  }
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
      // Password is now OPTIONAL. Omit it to invite the user by email (they set
      // their own password via a one-time link); supply one to set it directly.
      const wantsInvite = !password;
      if (!name?.trim() || !email?.includes("@") || !VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: "Need a name, a valid email and a valid role" }, { status: 400 });
      }
      if (!wantsInvite && password.length < 8) {
        return NextResponse.json({ error: "A password must be at least 8 characters (or leave it blank to email an invite)" }, { status: 400 });
      }

      // Invited accounts get an unguessable random password nobody knows, so
      // the only way in is the invite link. For an admin-issued starter
      // password, must_change_password defaults to true so the user is forced
      // to set their own on first sign-in (pass requireChange:false to opt out).
      const rawPassword = wantsInvite ? crypto.randomBytes(24).toString("hex") : password;
      const mustChange = wantsInvite ? true : body.requireChange !== false;
      const hash = await hashPassword(rawPassword);
      const { rows } = await query(
        `INSERT INTO users (email, name, password, must_change_password) VALUES (lower($1), $2, $3, $4)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [email.trim(), name.trim(), hash, mustChange]
      );
      if (!rows.length) return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
      const userId = rows[0].id;
      await setUserRole(userId, role, session.email);
      await query(`INSERT INTO workflow.team_capacity (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]).catch(() => {});
      await audit({ actor: session, eventType: "user.create", objectType: "users", objectRef: email.trim().toLowerCase(), detail: { role, invited: wantsInvite } });

      if (!wantsInvite) return NextResponse.json({ ok: true, invited: false });

      const delivery = await deliverLink({
        request,
        user: { id: userId, name: name.trim(), email: email.trim().toLowerCase() },
        purpose: "INVITE",
        actor: session,
      });
      await audit({ actor: session, eventType: "user.invite", objectType: "users", objectRef: email.trim().toLowerCase(), detail: { emailSent: delivery.emailSent } });
      return NextResponse.json({ ok: true, invited: true, ...delivery });
    }

    if (action === "invite" || action === "email-reset") {
      const { userId } = body;
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
      const { rows } = await query("SELECT id, name, email FROM users WHERE id = $1", [userId]);
      const user = rows[0];
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const purpose = action === "invite" ? "INVITE" : "RESET";
      // Re-inviting marks the account as awaiting a fresh set-up; an emailed
      // reset leaves the current password working until a new one is chosen.
      if (purpose === "INVITE") {
        await query(`UPDATE users SET must_change_password = true WHERE id = $1`, [userId]);
      }
      const delivery = await deliverLink({ request, user, purpose, actor: session });
      await audit({ actor: session, eventType: purpose === "INVITE" ? "user.invite" : "user.email-reset", objectType: "users", objectRef: String(userId), detail: { emailSent: delivery.emailSent } });
      return NextResponse.json({ ok: true, ...delivery });
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

    if (action === "set-department") {
      const { userId, department } = body;
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
      await setUserDepartment(userId, department || null);
      await audit({ actor: session, eventType: "user.set-department", objectType: "users", objectRef: String(userId), detail: { department: department || null } });
      return NextResponse.json({ ok: true });
    }

    if (action === "add-signoff") {
      const { department, email, name } = body;
      if (!department || !email) return NextResponse.json({ error: "Department and person required" }, { status: 400 });
      await addSignoff({ department, email, name }, session);
      await audit({ actor: session, eventType: "dept.signoff.add", objectType: "department_signoff", objectRef: department, detail: { email } });
      return NextResponse.json({ ok: true });
    }

    if (action === "remove-signoff") {
      const { signoffId } = body;
      if (!Number.isInteger(signoffId)) return NextResponse.json({ error: "Invalid sign-off id" }, { status: 400 });
      await removeSignoff(signoffId);
      await audit({ actor: session, eventType: "dept.signoff.remove", objectType: "department_signoff", objectRef: String(signoffId) });
      return NextResponse.json({ ok: true });
    }

    if (action === "set-po-self-approve-limit") {
      const raw = body.limit;
      const limit = Number(raw);
      if (!Number.isFinite(limit) || limit < 0) {
        return NextResponse.json({ error: "Enter a limit of £0 or more (0 turns self-approval off)" }, { status: 400 });
      }
      await setAppSetting("po_self_approve_limit", Math.round(limit), session);
      await audit({ actor: session, eventType: "settings.po_self_approve_limit", objectType: "app_setting", objectRef: "po_self_approve_limit", detail: { limit: Math.round(limit) } });
      return NextResponse.json({ ok: true, limit: Math.round(limit) });
    }

    if (action === "list-po-policies") {
      const [policies, departments] = await Promise.all([listDeptPoPolicies(), listDepartments()]);
      return NextResponse.json({ policies, departments });
    }

    if (action === "save-po-policy") {
      const p = body.policy || {};
      const err = validateDeptPoPolicy(p);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      const res = await upsertDeptPoPolicy(p, session);
      return NextResponse.json(res);
    }

    if (action === "list-report-permissions") {
      const [permissions, tpl, departments] = await Promise.all([listReportPermissions(), listTemplates(), listDepartments()]);
      const templates = Array.isArray(tpl) ? tpl : (tpl.templates || []);
      return NextResponse.json({
        permissions,
        templates: templates.map((t) => ({ template_key: t.template_key, name: t.name })),
        departments,
      });
    }

    if (action === "save-report-permission") {
      const p = body.permission || {};
      if (!p.department || !p.template_key) return NextResponse.json({ error: "Department and report required" }, { status: 400 });
      await setReportPermission(p, session);
      return NextResponse.json({ ok: true });
    }

    if (action === "set-visibility") {
      const { department, hiddenKeys } = body;
      if (!department || !Array.isArray(hiddenKeys)) return NextResponse.json({ error: "Department and hiddenKeys[] required" }, { status: 400 });
      await setNavVisibility(department, hiddenKeys, session);
      await audit({ actor: session, eventType: "dept.access.set", objectType: "nav_visibility", objectRef: department, detail: { hidden: hiddenKeys.length } });
      return NextResponse.json({ ok: true });
    }

    if (action === "reset-password") {
      const { userId, password } = body;
      if (!Number.isInteger(userId) || !password || password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      const hash = await hashPassword(password);
      // An admin-set password is a starter credential, so by default the user
      // must change it on next sign-in (pass requireChange:false to opt out —
      // e.g. setting a genuinely permanent password for a service account).
      const mustChange = body.requireChange !== false;
      await query(`UPDATE users SET password = $1, must_change_password = $2 WHERE id = $3`, [hash, mustChange, userId]);
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

    if (action === "clear-mfa") {
      const { userId } = body;
      if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
      // Escape hatch for a user who lost their device and recovery codes. Ends
      // their live sessions too, so the next sign-in re-enrols cleanly.
      await clearMfaForUser(userId, session);
      await endAllSessions(userId, session.email);
      await audit({ actor: session, eventType: "user.clear-mfa", objectType: "users", objectRef: String(userId) });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("admin/users error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
