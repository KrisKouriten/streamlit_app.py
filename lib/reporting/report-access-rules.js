/*
 * Corporate report access — pure rules (migration 064). No imports, no DB. Decides
 * whether a viewer may access a report template for a given verb, from their roles,
 * their department and the department's permission rows. Unit-tested in
 * tests/report-access-rules.test.mjs.
 *
 * Model: ADMIN / FINANCE / EXEC keep full access (the finance/exec team). Every
 * other role must be granted the verb on that template for their department. This
 * both preserves current behaviour (non-finance roles could not reach the Reporting
 * Centre before) and lets a department be granted specific reports.
 */

export const REPORT_VERBS = [
  "view", "create", "edit", "contribute", "review", "approve", "export", "view_confidential_appendix",
];

export const REPORT_VERB_COL = {
  view: "can_view", create: "can_create", edit: "can_edit", contribute: "can_contribute",
  review: "can_review", approve: "can_approve", export: "can_export",
  view_confidential_appendix: "can_view_confidential_appendix",
};

// Roles that retain full, unrestricted report access.
export const FULL_ACCESS_ROLES = ["ADMIN", "FINANCE", "EXEC", "HEAD"];

export function hasFullReportAccess(roles = []) {
  return (roles || []).some((r) => FULL_ACCESS_ROLES.includes(r));
}

// Roles allowed to download / export governed information (packs, board packs,
// forecast and PO exports). The reporting protection group: Finance, Exec, any
// department Head, and Admin. Everyone else is blocked server-side. See PR "data
// download control". Takes a session (or anything with a `roles` array).
export const EXPORT_ROLES = ["ADMIN", "EXEC", "FINANCE", "HEAD"];

export function canExport(session) {
  const roles = (session && session.roles) || [];
  return roles.some((r) => EXPORT_ROLES.includes(r));
}

// A permission row is usable when active and within its effective window. `today`
// is a yyyy-mm-dd string; when omitted, effective dates are not range-checked.
function permUsable(p, today) {
  if (!p || p.active === false) return false;
  if (today) {
    if (p.effective_from && String(today) < String(p.effective_from).slice(0, 10)) return false;
    if (p.effective_to && String(today) > String(p.effective_to).slice(0, 10)) return false;
  }
  return true;
}

// Can a viewer access `templateKey` for `verb`? Full-access roles always may; other
// roles need an active grant of that verb on that template for their department.
export function canAccessReport({ roles, permissions, templateKey, verb = "view", today } = {}) {
  if (hasFullReportAccess(roles)) return true;
  const col = REPORT_VERB_COL[verb] || "can_view";
  return (permissions || []).some(
    (p) => p.template_key === templateKey && permUsable(p, today) && p[col] === true
  );
}

// The set of template_keys a viewer may access for a verb (full-access roles get
// null = "all"; other roles get the explicit granted list).
export function accessibleTemplateKeys({ roles, permissions, verb = "view", today } = {}) {
  if (hasFullReportAccess(roles)) return null; // null = unrestricted
  const col = REPORT_VERB_COL[verb] || "can_view";
  return Array.from(new Set(
    (permissions || []).filter((p) => permUsable(p, today) && p[col] === true).map((p) => p.template_key)
  ));
}

// Filter a list of report instances (each carrying template_key) to those a viewer
// may see. Full-access roles keep everything.
export function filterViewableReports(reports = [], { roles, permissions, today } = {}) {
  if (hasFullReportAccess(roles)) return reports;
  const allowed = new Set(accessibleTemplateKeys({ roles, permissions, verb: "view", today }));
  return reports.filter((r) => allowed.has(r.template_key));
}
