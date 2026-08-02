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

// ---- Corporate report access by department (migration 064) ----
const REPORT_PERM_COLS = `perm_id, department, template_key, can_view, can_create, can_edit,
  can_contribute, can_review, can_approve, can_export, can_view_confidential_appendix,
  effective_from, effective_to, active, updated_by, updated_at`;

export async function listReportPermissions() {
  try {
    const { rows } = await query(
      `SELECT ${REPORT_PERM_COLS} FROM governance.department_report_permission ORDER BY department, template_key`);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// A department's permission rows (empty before migration or when unconfigured).
export async function getReportPermissionsForDepartment(department) {
  if (!department) return [];
  try {
    const { rows } = await query(
      `SELECT ${REPORT_PERM_COLS} FROM governance.department_report_permission WHERE department = $1`, [department]);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// The signed-in user's department (users.department, migration 047).
export async function getUserDepartmentById(userId) {
  try {
    const { rows } = await query(`SELECT department FROM public.users WHERE id = $1`, [userId]);
    return rows[0]?.department || null;
  } catch {
    return null;
  }
}

// Upsert a department's permission for one report template (verb matrix).
export async function setReportPermission(p, actor) {
  const b = (v) => v === true;
  await query(
    `INSERT INTO governance.department_report_permission
       (department, template_key, can_view, can_create, can_edit, can_contribute, can_review,
        can_approve, can_export, can_view_confidential_appendix, effective_from, effective_to, active, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
     ON CONFLICT (department, template_key) DO UPDATE SET
        can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit,
        can_contribute = EXCLUDED.can_contribute, can_review = EXCLUDED.can_review, can_approve = EXCLUDED.can_approve,
        can_export = EXCLUDED.can_export, can_view_confidential_appendix = EXCLUDED.can_view_confidential_appendix,
        effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to, active = EXCLUDED.active,
        updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [p.department, p.template_key, b(p.can_view), b(p.can_create), b(p.can_edit), b(p.can_contribute),
     b(p.can_review), b(p.can_approve), b(p.can_export), b(p.can_view_confidential_appendix),
     p.effective_from || null, p.effective_to || null, p.active === false ? false : true,
     actor?.email || actor?.name || "system"]);
  await audit({ actor, eventType: "report_access.set", objectType: "department_report_permission", objectRef: `${p.department}:${p.template_key}`, detail: { view: b(p.can_view) } });
  return { ok: true };
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
// This is the ORG-WIDE fallback used when a department has no policy (migration 063).
export async function getPoSelfApproveLimit() {
  const raw = await getAppSetting("po_self_approve_limit", "0");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---- Department P.O self-approval policy (migration 063) ----
const POLICY_COLS = `policy_id, department, count_limit, measurement_period, period_reset_rule,
  custom_period_days, max_individual_value, max_cumulative_value, line_manager_email, line_manager_name,
  secondary_email, secondary_name, cancelled_po_policy, exception_policy, notes, effective_from,
  effective_to, active, updated_by, updated_at`;

export async function getDeptPoPolicy(department) {
  if (!department) return null;
  try {
    const { rows } = await query(
      `SELECT ${POLICY_COLS} FROM governance.dept_po_policy WHERE department = $1`, [department]);
    return rows[0] || null;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

export async function listDeptPoPolicies() {
  try {
    const { rows } = await query(
      `SELECT ${POLICY_COLS} FROM governance.dept_po_policy ORDER BY department`);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// Upsert a department's policy (one row per department). Numeric/date blanks are
// stored as NULL so "no cap" is distinct from zero.
export async function upsertDeptPoPolicy(p, actor) {
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const txt = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const { rows } = await query(
    `INSERT INTO governance.dept_po_policy
       (department, count_limit, measurement_period, period_reset_rule, custom_period_days,
        max_individual_value, max_cumulative_value, line_manager_email, line_manager_name,
        secondary_email, secondary_name, cancelled_po_policy, exception_policy, notes,
        effective_from, effective_to, active, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_TIMESTAMP)
     ON CONFLICT (department) DO UPDATE SET
        count_limit = EXCLUDED.count_limit, measurement_period = EXCLUDED.measurement_period,
        period_reset_rule = EXCLUDED.period_reset_rule, custom_period_days = EXCLUDED.custom_period_days,
        max_individual_value = EXCLUDED.max_individual_value, max_cumulative_value = EXCLUDED.max_cumulative_value,
        line_manager_email = EXCLUDED.line_manager_email, line_manager_name = EXCLUDED.line_manager_name,
        secondary_email = EXCLUDED.secondary_email, secondary_name = EXCLUDED.secondary_name,
        cancelled_po_policy = EXCLUDED.cancelled_po_policy, exception_policy = EXCLUDED.exception_policy,
        notes = EXCLUDED.notes, effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to,
        active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
     RETURNING policy_id`,
    [txt(p.department), num(p.count_limit), p.measurement_period || "FINANCIAL_PERIOD", txt(p.period_reset_rule),
     num(p.custom_period_days), num(p.max_individual_value), num(p.max_cumulative_value), txt(p.line_manager_email),
     txt(p.line_manager_name), txt(p.secondary_email), txt(p.secondary_name), p.cancelled_po_policy || "RETAIN_IN_COUNT",
     txt(p.exception_policy), txt(p.notes), p.effective_from || null, p.effective_to || null,
     p.active === false ? false : true, actor?.email || actor?.name || "system"]);
  await audit({ actor, eventType: "po_policy.upsert", objectType: "dept_po_policy", objectRef: txt(p.department), detail: { policyId: rows[0]?.policy_id } });
  return { ok: true, policyId: rows[0]?.policy_id };
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
