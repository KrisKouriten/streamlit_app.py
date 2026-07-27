/*
 * Invite / password-reset token store (I/O). Pure decisions live in
 * invite-rules.js; this module owns token generation, hashing and the DB.
 *
 * Security model: a high-entropy random token is generated, its SHA-256 hash
 * is stored, and the raw token is returned to the caller exactly once so it can
 * go into the emailed link. On redemption we hash the presented token and look
 * up by hash — the raw value is never persisted, so a database leak cannot be
 * used to mint working links. Tokens are single-use and time-boxed.
 */

import crypto from "node:crypto";
import { query } from "./db.js";
import { INVITE_TTL_HOURS, inviteTokenState } from "./invite-rules.js";

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

/*
 * Create a fresh invite for a user, superseding any of their still-open ones
 * (a user should only ever have one live link). Returns the RAW token and the
 * expiry — the caller emails the link and never stores the raw token.
 */
export async function createInvite({ userId, purpose = "INVITE", createdBy = null, ttlHours = INVITE_TTL_HOURS } = {}) {
  const raw = crypto.randomBytes(32).toString("base64url"); // ~256 bits, URL-safe
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // Retire any earlier unused links for this user so only the newest works.
  await query(
    `UPDATE governance.user_invite SET used_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  await query(
    `INSERT INTO governance.user_invite (user_id, token_hash, purpose, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, purpose, expiresAt, createdBy]
  );
  return { rawToken: raw, expiresAt, ttlHours };
}

/*
 * Look up a presented raw token and return { valid, reason, invite } without
 * consuming it. `invite` (when valid) carries invite_id, user_id, name, email
 * so the set-password page can greet the user and the API can act.
 */
export async function findInvite(rawToken) {
  if (!rawToken) return { valid: false, reason: "missing", invite: null };
  const { rows } = await query(
    `SELECT i.invite_id, i.user_id, i.purpose, i.expires_at, i.used_at,
            u.name, u.email
       FROM governance.user_invite i
       JOIN public.users u ON u.id = i.user_id
      WHERE i.token_hash = $1`,
    [hashToken(rawToken)]
  );
  const row = rows[0] || null;
  const state = inviteTokenState(row, Date.now());
  return { valid: state.valid, reason: state.reason, invite: state.valid ? row : null };
}

/*
 * Redeem an invite: verify the token is still valid, set the user's password,
 * clear must_change_password, mark the token used, and revoke every existing
 * session for the account so it starts clean. Returns { ok, userId } or an
 * error reason. `passwordHash` must already be bcrypt-hashed by the caller.
 */
export async function redeemInvite({ rawToken, passwordHash }) {
  const found = await findInvite(rawToken);
  if (!found.valid) return { ok: false, reason: found.reason };
  const { invite_id: inviteId, user_id: userId } = found.invite;

  // Guarded update: only spend the token if it is STILL unused and unexpired,
  // so two concurrent submits cannot both succeed.
  const spent = await query(
    `UPDATE governance.user_invite
        SET used_at = CURRENT_TIMESTAMP
      WHERE invite_id = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [inviteId]
  );
  if (spent.rowCount !== 1) return { ok: false, reason: "used" };

  await query(
    `UPDATE public.users SET password = $1, must_change_password = false WHERE id = $2`,
    [passwordHash, userId]
  );
  return { ok: true, userId, purpose: found.invite.purpose, email: found.invite.email };
}
