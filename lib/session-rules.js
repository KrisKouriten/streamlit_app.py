/*
 * Session lifecycle rules — pure, import-free, unit-tested.
 *
 * A session is the server-side source of truth for "is this login still good".
 * The JWT in the cookie only carries a session id; every request re-derives
 * validity from the stored row using the rules below. Keeping this logic pure
 * means the exact expiry / idle / revocation behaviour is testable without a
 * database or a clock.
 *
 * Two independent expiry clocks:
 *   - absolute lifetime: a session dies a fixed time after sign-in, however
 *     active the user is (bounds the blast radius of a stolen cookie).
 *   - idle timeout: a session dies after a stretch of no activity, even if the
 *     absolute window has not elapsed.
 * A session is valid only while BOTH clocks are unexpired and it is not revoked.
 */

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12h hard cap
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; //  8h since last activity
// Only bump last_seen_at when it is at least this stale — coalesces the write
// so an active user does not generate a DB write on every single request.
export const RENEW_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

// Accept Date, epoch-ms number, or ISO string; return epoch ms (or null).
export function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// The absolute expiry for a session created at createdAtMs.
export function computeExpiry(createdAtMs) {
  return createdAtMs + SESSION_ABSOLUTE_MS;
}

/*
 * Decide whether a stored session row is still usable.
 * row: { created_at, last_seen_at, expires_at, revoked_at }
 * Returns { valid, reason } — reason is one of
 *   'revoked' | 'expired' | 'idle' | 'malformed', or null when valid.
 */
export function sessionValidity(row, nowMs) {
  if (!row) return { valid: false, reason: "malformed" };

  const lastSeen = toMs(row.last_seen_at);
  const expires = toMs(row.expires_at);
  const revoked = toMs(row.revoked_at);
  if (lastSeen == null || expires == null) return { valid: false, reason: "malformed" };

  if (revoked != null) return { valid: false, reason: "revoked" };
  if (nowMs >= expires) return { valid: false, reason: "expired" };
  if (nowMs - lastSeen >= SESSION_IDLE_MS) return { valid: false, reason: "idle" };

  return { valid: true, reason: null };
}

// Whether last_seen_at is stale enough that we should write a fresh timestamp.
export function shouldRenewLastSeen(lastSeenMs, nowMs) {
  if (lastSeenMs == null) return true;
  return nowMs - lastSeenMs >= RENEW_THRESHOLD_MS;
}
