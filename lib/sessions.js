import { query } from "./db";
import { computeExpiry, shouldRenewLastSeen, toMs } from "./session-rules";

/*
 * Server-side session store. The session row (governance.session) is the
 * source of truth for whether a login is still good; the JWT cookie only
 * carries the sid. Validity decisions live in session-rules.js — this layer is
 * just the reads and writes.
 *
 * One clock: all timestamps here are set from the app's Date.now() and compared
 * against Date.now() in auth.getSession(), so there is no JS-vs-DB clock skew in
 * the validity maths.
 */

// Open a new session for a user. Returns the sid (uuid string).
export async function createSession({ userId, ip = null, userAgent = null }) {
  const now = new Date();
  const expires = new Date(computeExpiry(now.getTime()));
  const { rows } = await query(
    `INSERT INTO governance.session (user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $2, $3, $4, $5)
     RETURNING sid`,
    [userId, now.toISOString(), expires.toISOString(), ip, userAgent ? String(userAgent).slice(0, 500) : null]
  );
  return rows[0].sid;
}

// Load a session joined to its owner's live account state. Returns null if the
// sid is unknown. is_active reflects the account right now, so a deactivated
// user's live sessions stop working immediately.
export async function getSessionRow(sid) {
  if (!sid) return null;
  const { rows } = await query(
    `SELECT s.sid, s.user_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            u.name, u.email, u.is_active
     FROM governance.session s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.sid = $1`,
    [sid]
  );
  return rows[0] || null;
}

// Bump last_seen_at, but only when it is stale enough to be worth a write.
// Returns true if a write happened.
export async function touchSession(sid, lastSeenAt) {
  const now = Date.now();
  if (!shouldRenewLastSeen(toMs(lastSeenAt), now)) return false;
  await query(`UPDATE governance.session SET last_seen_at = $2 WHERE sid = $1 AND revoked_at IS NULL`, [
    sid,
    new Date(now).toISOString(),
  ]);
  return true;
}

// Revoke a single session (ordinary logout). Idempotent — a second call on an
// already-revoked session is a no-op.
export async function revokeSession(sid, revokedBy = "self", reason = "logout") {
  if (!sid) return;
  await query(
    `UPDATE governance.session
     SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, revoked_reason = $3
     WHERE sid = $1 AND revoked_at IS NULL`,
    [sid, revokedBy, reason]
  );
}

// Revoke every active session for a user (logout-everywhere, or on
// deactivation / password change). Returns the number of sessions killed.
export async function revokeAllForUser(userId, revokedBy = "self", reason = "logout_all") {
  const { rowCount } = await query(
    `UPDATE governance.session
     SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2, revoked_reason = $3
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, revokedBy, reason]
  );
  return rowCount;
}

// Active (unrevoked, unexpired) sessions for a user — for a "signed-in devices"
// view. Ordered most-recently-active first.
export async function listActiveSessionsForUser(userId) {
  const { rows } = await query(
    `SELECT sid, created_at, last_seen_at, expires_at, ip, user_agent
     FROM governance.session
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_seen_at DESC`,
    [userId]
  );
  return rows;
}

// Housekeeping: mark long-dead sessions revoked so the table does not grow
// without bound. Anything past its absolute expiry that was never revoked is
// stamped 'expired_swept'. Returns how many rows were swept.
export async function sweepExpiredSessions() {
  const { rowCount } = await query(
    `UPDATE governance.session
     SET revoked_at = CURRENT_TIMESTAMP, revoked_by = 'system', revoked_reason = 'expired_swept'
     WHERE revoked_at IS NULL AND expires_at <= CURRENT_TIMESTAMP`
  );
  return rowCount;
}
