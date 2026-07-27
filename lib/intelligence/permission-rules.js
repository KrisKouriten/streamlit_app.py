/*
 * The permission seam for the Finance Intelligence Layer (CR §9), kept pure so
 * it is unit-testable and has one obvious place to change.
 *
 * IMPORTANT — current state: the platform has NO row-level / data-scope security
 * yet. Every authenticated finance/admin user already sees all 26 entities and
 * all stores across the app. So today this returns an UNRESTRICTED scope for
 * those roles — the AI is deliberately given exactly the visibility the pages
 * themselves grant, never more. When real per-user entity/store/region scoping
 * is built, only this module (and its DB-backed caller lib/intelligence/permission.js)
 * change; every retrieval path already asks here first and never decides for itself.
 */

export const FULL_VISIBILITY_ROLES = ["ADMIN", "EXEC", "FINANCE"];

// Resolve the data scope a session may see. `unrestricted` mirrors today's app
// behaviour for finance/admin; the entity/store/region arrays are the forward
// hooks (null = no restriction) that a future scoping model will populate.
export function resolveScope(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  const unrestricted = roles.some((r) => FULL_VISIBILITY_ROLES.includes(r));
  return {
    unrestricted,
    entityIds: null, // null = unscoped; future: number[]
    storeIds: null,
    regions: null,
    roles,
    note: unrestricted
      ? "Full finance visibility (all entities and stores)."
      : "This account has no finance data-scope grant, so financial detail is withheld.",
  };
}

// Would this scope permit a specific entity / store row? Future-proofing — today
// an unrestricted scope passes everything; a scoped one checks its allow-lists.
export function scopeAllows(scope, { entityId = null, storeId = null } = {}) {
  if (!scope) return false;
  if (scope.unrestricted) return true;
  if (entityId != null && Array.isArray(scope.entityIds)) return scope.entityIds.includes(entityId);
  if (storeId != null && Array.isArray(scope.storeIds)) return scope.storeIds.includes(storeId);
  return false;
}

// May we surface a cross-entity/region comparison or ranking? A scoped user must
// not be told "second out of five" when they can't see the other four (CR §9).
export function mayCompareAcrossScope(scope) {
  return !!scope?.unrestricted;
}
