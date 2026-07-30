import { query } from "./db";
import { DEPARTMENT_DASHBOARD_DEPTS, deptDashboardHref } from "./nav-registry";
import { itemKey } from "./nav-visibility-rules";

/*
 * Governance layer: roles, users, audit trail and data freshness.
 * Every state-changing API handler should call audit() — the audit trail is
 * only as complete as the discipline of writing to it.
 */

export async function getUserRoles(userId) {
  const { rows } = await query(
    `SELECT role_code FROM governance.user_role WHERE user_id = $1 ORDER BY role_code`,
    [userId]
  );
  return rows.map((r) => r.role_code);
}

// Write one audit event. Never throws — an audit failure must not break the
// user's action — but logs loudly so it can't fail silently for long.
export async function audit({ actor, eventType, objectType = null, objectRef = null, detail = null }) {
  try {
    await query(
      `INSERT INTO governance.audit_event (actor_email, actor_name, event_type, object_type, object_ref, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor?.email || null, actor?.name || null, eventType, objectType, objectRef, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) {
    console.error("AUDIT WRITE FAILED", eventType, objectRef, e.message);
  }
}

export async function listUsersWithRoles() {
  const sql = (deptCol) =>
    `SELECT u.id, u.email, u.name, u.is_active, u.created_at, u.must_change_password, ${deptCol} AS department,
            COALESCE(array_agg(r.role_code ORDER BY r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
     FROM public.users u
     LEFT JOIN governance.user_role r ON r.user_id = u.id
     GROUP BY u.id ORDER BY u.name`;
  try {
    const { rows } = await query(sql("u.department"));
    return rows;
  } catch (e) {
    // public.users.department not added yet (pre-migration 047) — degrade gracefully.
    if (e?.code === "42703") { const { rows } = await query(sql("NULL::varchar")); return rows; }
    throw e;
  }
}

// Assign (or clear) a user's department. Department is a free-form governed name
// from core.dim_department (seeded in migration 047).
export async function setUserDepartment(userId, department) {
  await query(`UPDATE public.users SET department = $2 WHERE id = $1`, [userId, department || null]);
}

export async function listDepartments() {
  try {
    const { rows } = await query(`SELECT department_code, department_name FROM core.dim_department ORDER BY department_name`);
    return rows;
  } catch (e) {
    if (e?.code === "42P01") return [];
    throw e;
  }
}

const missing = (e) => e?.code === "42P01" || e?.code === "42703";

// ---- Department sign-off (who approves a department's budgets & P.Os) ----
export async function listSignoffs() {
  try {
    const { rows } = await query(
      `SELECT signoff_id, department, signoff_email, signoff_name
       FROM governance.department_signoff ORDER BY department, signoff_name`
    );
    return rows;
  } catch (e) { if (missing(e)) return []; throw e; }
}

export async function addSignoff({ department, email, name }, actor) {
  await query(
    `INSERT INTO governance.department_signoff (department, signoff_email, signoff_name, created_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT (department, signoff_email) DO UPDATE SET signoff_name = EXCLUDED.signoff_name`,
    [department, email, name || null, actor?.email || actor?.name || "system"]
  );
}

export async function removeSignoff(signoffId) {
  await query(`DELETE FROM governance.department_signoff WHERE signoff_id = $1`, [signoffId]);
}

// ---- Per-department navigation visibility ----
export async function listNavVisibility() {
  try {
    const { rows } = await query(`SELECT department, node_key FROM governance.nav_visibility`);
    return rows;
  } catch (e) { if (missing(e)) return []; throw e; }
}

// Replace a department's hidden-node set.
export async function setNavVisibility(department, hiddenKeys = [], actor) {
  await query(`DELETE FROM governance.nav_visibility WHERE department = $1`, [department]);
  for (const key of hiddenKeys) {
    await query(
      `INSERT INTO governance.nav_visibility (department, node_key, created_by) VALUES ($1,$2,$3)
       ON CONFLICT (department, node_key) DO NOTHING`,
      [department, key, actor?.email || actor?.name || "system"]
    );
  }
}

// The hidden nav nodes for the signed-in user's department. Admins (and users
// with no department, or before migration 048) get nothing hidden.
export async function getHiddenNavForSession(session) {
  try {
    if (!session || (session.roles || []).includes("ADMIN")) return [];
    const { rows: u } = await query(`SELECT department FROM public.users WHERE id = $1`, [session.id]);
    const dept = u[0]?.department;
    const roles = session.roles || [];
    // Finance/Exec see every department dashboard; other users see only their own.
    const seesAllDepts = roles.includes("FINANCE") || roles.includes("EXEC");
    const auto = [];
    if (!seesAllDepts) {
      for (const d of DEPARTMENT_DASHBOARD_DEPTS) {
        if ((d || "").toLowerCase() !== (dept || "").toLowerCase()) {
          auto.push(itemKey({ key: "dashboards" }, { href: deptDashboardHref(d) }));
        }
      }
    }
    if (!dept) return auto;
    const { rows } = await query(`SELECT node_key FROM governance.nav_visibility WHERE department = $1`, [dept]);
    return [...new Set([...rows.map((r) => r.node_key), ...auto])];
  } catch {
    return []; // never break the shell over a visibility lookup
  }
}

export async function listRoles() {
  const { rows } = await query(`SELECT role_code, role_name, description FROM governance.role ORDER BY role_code`);
  return rows;
}

export async function setUserRole(userId, roleCode, grantedBy) {
  // One primary role per user in Phase 1: replace existing assignments.
  await query(`DELETE FROM governance.user_role WHERE user_id = $1`, [userId]);
  await query(
    `INSERT INTO governance.user_role (user_id, role_code, granted_by) VALUES ($1, $2, $3)`,
    [userId, roleCode, grantedBy]
  );
}

// ---- App settings (governance.app_setting, migration 062) ----
// General-purpose key/value store. Degrades to a default before the table
// exists so callers never crash pre-migration.
export async function getAppSetting(key, fallback = null) {
  try {
    const { rows } = await query(`SELECT setting_value FROM governance.app_setting WHERE setting_key = $1`, [key]);
    return rows.length ? rows[0].setting_value : fallback;
  } catch (e) {
    if (e?.code === "42P01") return fallback;
    throw e;
  }
}

export async function setAppSetting(key, value, actor) {
  await query(
    `INSERT INTO governance.app_setting (setting_key, setting_value, updated_by, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [key, value == null ? null : String(value), actor?.email || actor?.name || "system"]
  );
}

// The P.O self-approval limit in £ (0 = feature off). Always a finite number.
export async function getPoSelfApproveLimit() {
  const raw = await getAppSetting("po_self_approve_limit", "0");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Latest successful refresh per dashboard — powers the freshness stamps.
export async function getFreshness(dashboardCode) {
  const { rows } = await query(
    `SELECT source_system, completed_at, rows_loaded
     FROM governance.data_refresh_log
     WHERE status = 'SUCCESS' AND ($1::varchar IS NULL OR dashboard_code = $1)
     ORDER BY completed_at DESC LIMIT 1`,
    [dashboardCode]
  );
  return rows[0] || null;
}

export async function recentAuditEvents(limit = 50) {
  const { rows } = await query(
    `SELECT occurred_at, actor_email, event_type, object_type, object_ref, detail
     FROM governance.audit_event ORDER BY occurred_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
