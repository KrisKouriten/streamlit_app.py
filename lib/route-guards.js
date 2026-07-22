/*
 * Route access policy — pure, edge-safe (no DB, no node-only imports), so both
 * the root middleware (Edge runtime) and server components (Node) can consult
 * the same rules. The role policy is DERIVED from the navigation registry's
 * `restrictedTo`, so there is one source of truth for "who sees what".
 */

import { NAV_SECTIONS } from "./nav-registry.js";

/*
 * Role gating is BUILT but held OFF until the first non-finance user exists.
 * Today every user is finance/admin, so a gate would only be a no-op that
 * risks locking someone out. When a non-finance user is created, flip this to
 * true (or set ENFORCE_ROLE_GATES=1 in the environment) — the policy below is
 * already wired from the nav registry.
 */
export const ENFORCE_ROLE_GATES =
  process.env.ENFORCE_ROLE_GATES === "1" || process.env.ENFORCE_ROLE_GATES === "true";

// Paths reachable without a session. Everything else needs a valid login.
//  - /login                       the sign-in page itself
//  - /api/auth/login|logout|me    the auth handshake (self-guarding)
//  - /api/health                  monitoring probe (no data)
//  - /api/joiin-refresh           self-guarding: Bearer CRON_SECRET for the
//                                  Vercel cron, or ADMIN/FINANCE session for a
//                                  manual refresh — so the cron (no cookie)
//                                  must not be blocked by the auth gate here
const PUBLIC_EXACT = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/mfa-verify", // second factor: authed by the pending ticket, not a session
  "/api/auth/logout",
  "/api/auth/me",
  "/api/health",
  "/api/joiin-refresh",
]);

export function isPublicPath(pathname) {
  return PUBLIC_EXACT.has(pathname);
}

// Concrete { path, roles } guards derived from restricted nav sections. Each
// restricted item contributes its live route (href) or its /module/<slug>
// placeholder route.
export function restrictedRoutes() {
  const out = [];
  for (const section of NAV_SECTIONS) {
    const roles = section.restrictedTo;
    if (!Array.isArray(roles) || !roles.length) continue;
    for (const item of section.items || []) {
      if (item.href) out.push({ path: item.href, roles });
      else if (item.slug) out.push({ path: `/module/${item.slug}`, roles });
    }
  }
  return out;
}

const ROUTES = restrictedRoutes();

// The roles required to view a path, or null when it is unguarded — or when
// gating is switched off, in which case nothing is guarded.
export function requiredRolesForPath(pathname) {
  if (!ENFORCE_ROLE_GATES) return null;
  for (const { path, roles } of ROUTES) {
    if (pathname === path || pathname.startsWith(path + "/")) return roles;
  }
  return null;
}

// Does a set of held roles satisfy a requirement?
export function isAllowed(heldRoles, requiredRoles) {
  if (!Array.isArray(requiredRoles) || !requiredRoles.length) return true;
  const have = Array.isArray(heldRoles) ? heldRoles : [];
  return have.some((r) => requiredRoles.includes(r));
}
