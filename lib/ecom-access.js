/*
 * HO-ECOM access — pure, edge-safe (no DB), shared by the middleware, the
 * sidebar and the E-COM pages. Unit-tested in tests/ecom-access.test.mjs.
 *
 *   ECOM users   see HO-ECOM and nothing else: every other page sends them to
 *                the E-COM dashboard, every other API refuses them. They keep
 *                the essentials — their account, password and sign-out.
 *   Who sees it  ECOM, plus Finance, Exec and Admin, who see everything.
 *                Anyone else is sent home from HO-ECOM.
 *
 * Unlike the department gates in route-guards.js this is always on: an ECOM
 * user exists to be kept to E-COM, so there is nothing to hold it back for.
 */

export const ECOM_ROLE = "ECOM";
export const ECOM_HOME = "/ho-ecom";
export const ECOM_VIEW_ROLES = ["ADMIN", "FINANCE", "EXEC", ECOM_ROLE];
// Roles that see the whole platform — an ECOM role alongside one of these is
// not held to HO-ECOM.
const WHOLE_PLATFORM = ["ADMIN", "FINANCE", "EXEC"];

const rolesOf = (roles) => (Array.isArray(roles) ? roles : []);

export const canSeeEcom = (roles) => rolesOf(roles).some((r) => ECOM_VIEW_ROLES.includes(r));
export const isEcomOnly = (roles) => rolesOf(roles).includes(ECOM_ROLE) && !rolesOf(roles).some((r) => WHOLE_PLATFORM.includes(r));

// Where an ECOM-only user may go. Prefixes, matched on a path boundary.
const ECOM_ONLY_ALLOWED = [
  ECOM_HOME, "/api/ecom", "/section/ho-ecom",
  "/account", "/api/account", "/change-password",
  "/api/auth", "/api/notifications",
];
const under = (path, prefix) => path === prefix || path.startsWith(prefix + "/");
export const isEcomPath = (path) => under(path, ECOM_HOME) || under(path, "/api/ecom");

/*
 * The decision for one request.
 *   → null               carry on
 *   → { redirect: path } a page the user may not see
 *   → { forbid: true }   an API the user may not call (the caller sends 403)
 */
export function ecomGate(pathname, roles) {
  const isApi = pathname.startsWith("/api/");
  if (isEcomOnly(roles)) {
    if (ECOM_ONLY_ALLOWED.some((p) => under(pathname, p))) return null;
    return isApi ? { forbid: true } : { redirect: ECOM_HOME };
  }
  if (isEcomPath(pathname) && !canSeeEcom(roles)) return isApi ? { forbid: true } : { redirect: "/" };
  return null;
}

/*
 * The sidebar sections hidden for a user, as nav visibility keys ("sec:<key>"):
 * an ECOM-only user sees only HO-ECOM; anyone who can't see E-COM loses the
 * HO-ECOM section and the E-COM dashboard entry.
 */
export function ecomHiddenNav(sections = [], roles = []) {
  if (isEcomOnly(roles)) return sections.filter((s) => s.key !== "ho-ecom").map((s) => `sec:${s.key}`);
  if (!canSeeEcom(roles)) {
    const out = ["sec:ho-ecom"];
    for (const s of sections) for (const it of s.items || []) if (it.href && isEcomPath(it.href.split("?")[0])) out.push(`item:${s.key}:${it.href}`);
    return out;
  }
  return [];
}
