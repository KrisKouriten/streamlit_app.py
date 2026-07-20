import { query } from "./db";

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
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.is_active, u.created_at,
            COALESCE(array_agg(r.role_code ORDER BY r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
     FROM public.users u
     LEFT JOIN governance.user_role r ON r.user_id = u.id
     GROUP BY u.id ORDER BY u.name`
  );
  return rows;
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
