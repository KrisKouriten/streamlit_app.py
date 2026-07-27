import { resolveScope } from "./permission-rules";

/*
 * The permission seam (CR §9) — server-side resolution of what a session may
 * see, called BEFORE any retrieval. Today it defers entirely to the pure rules
 * (full visibility for finance/admin, matching the rest of the app, which has
 * no row-level security yet). It is a thin wrapper on purpose: when real
 * per-user entity/store/region scoping arrives it becomes a DB-backed lookup
 * here, and no caller changes.
 */
export function scopeForSession(session) {
  return resolveScope(session);
}
