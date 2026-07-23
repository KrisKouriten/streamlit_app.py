import crypto from "crypto";
import bcrypt from "bcryptjs";
import { query } from "./db";
import { audit } from "./governance";
import { base32Encode, verifyTotp, otpauthUri, normalizeCode } from "./totp-rules.js";

/*
 * Two-step sign-in (TOTP MFA) — DB layer. The deterministic crypto lives in
 * totp-rules.js; here we store an encrypted secret and one-time recovery codes,
 * drive enrolment, and verify the second factor at login with a lockout to bound
 * online guessing of the 6-digit code.
 *
 * Secret at rest: the TOTP secret must be reversible to verify, so it is
 * encrypted with AES-256-GCM under a key derived from MFA_SECRET_KEY (preferred)
 * or SESSION_SECRET. Rotating that key makes existing secrets undecryptable —
 * enrolled users then fall back to a recovery code, or an admin clears their MFA.
 */

const tableMissing = (e) => e?.code === "42P01";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RECOVERY_COUNT = 10;

function encKey() {
  const src = process.env.MFA_SECRET_KEY || process.env.SESSION_SECRET || "";
  return crypto.createHash("sha256").update(src).digest(); // 32 bytes
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(b64) {
  const raw = Buffer.from(String(b64), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function newSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit secret
}

// Recovery codes: 10 chars of base32 shown as XXXXX-XXXXX; stored bcrypt-hashed,
// compared case-insensitively with separators stripped.
function newRecoveryCodes(n = RECOVERY_COUNT) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}
const normRecovery = (code) => String(code || "").toUpperCase().replace(/[\s-]/g, "");

async function getRow(userId) {
  const { rows } = await query(
    `SELECT user_id, secret_enc, enabled, last_step, failed_attempts, locked_until, confirmed_at
     FROM governance.user_mfa WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

// Cheap boolean for the login path — is MFA active for this user?
export async function hasEnabledMfa(userId) {
  try {
    const { rows } = await query(`SELECT 1 FROM governance.user_mfa WHERE user_id = $1 AND enabled`, [userId]);
    return rows.length > 0;
  } catch (e) {
    if (tableMissing(e)) return false; // migration 029 not run yet → MFA simply off
    throw e;
  }
}

export async function getMfaStatus(userId) {
  try {
    const row = await getRow(userId);
    let recoveryRemaining = 0;
    if (row?.enabled) {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM governance.mfa_recovery_code WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      );
      recoveryRemaining = rows[0]?.n || 0;
    }
    return {
      ready: true,
      enrolled: !!row?.enabled,
      pending: !!row && !row.enabled,
      confirmedAt: row?.confirmed_at || null,
      locked: !!(row?.locked_until && new Date(row.locked_until) > new Date()),
      recoveryRemaining,
    };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, enrolled: false, pending: false, recoveryRemaining: 0 };
    throw e;
  }
}

// Start (or restart) enrolment: mint a fresh secret, store it disabled. Blocked
// while MFA is already on — turn it off first, so a working secret is never
// silently replaced.
export async function beginEnrolment(userId, email, actor) {
  const row = await getRow(userId);
  if (row?.enabled) throw new Error("Two-step is already on — turn it off before re-enrolling");
  const secret = newSecret();
  const secret_enc = encryptSecret(secret);
  await query(
    `INSERT INTO governance.user_mfa (user_id, secret_enc, enabled, last_step, failed_attempts, locked_until, confirmed_at, updated_at)
     VALUES ($1, $2, false, NULL, 0, NULL, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enabled = false,
       last_step = NULL, failed_attempts = 0, locked_until = NULL, confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    [userId, secret_enc]
  );
  await audit({ actor, eventType: "mfa.enrol.begin", objectType: "users", objectRef: String(userId) });
  return { secret, otpauth: otpauthUri({ secret, account: email || String(userId) }) };
}

// Confirm the pending secret with a live code; on success enable MFA and mint
// recovery codes (returned once, in the clear).
export async function confirmEnrolment(userId, code, actor) {
  const row = await getRow(userId);
  if (!row) throw new Error("Start enrolment first");
  if (row.enabled) throw new Error("Two-step is already on");
  const secret = decryptSecret(row.secret_enc);
  const res = verifyTotp(secret, code, Math.floor(Date.now() / 1000), { window: 1 });
  if (!res.ok) throw new Error("That code didn't match — check the time on your device and try again");

  await query(
    `UPDATE governance.user_mfa SET enabled = true, last_step = $2, failed_attempts = 0, locked_until = NULL,
       confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId, res.step]
  );
  const recoveryCodes = await resetRecoveryCodes(userId);
  await audit({ actor, eventType: "mfa.enrol.confirm", objectType: "users", objectRef: String(userId) });
  return { recoveryCodes };
}

async function resetRecoveryCodes(userId) {
  const codes = newRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(normRecovery(c), 10)));
  await query(`DELETE FROM governance.mfa_recovery_code WHERE user_id = $1`, [userId]);
  for (const h of hashes) {
    await query(`INSERT INTO governance.mfa_recovery_code (user_id, code_hash) VALUES ($1, $2)`, [userId, h]);
  }
  return codes;
}

function lockedResponse(row) {
  return { ok: false, locked: true, until: row.locked_until };
}

async function registerFailure(userId, row) {
  const failed = (row.failed_attempts || 0) + 1;
  const lock = failed >= MAX_ATTEMPTS;
  await query(
    `UPDATE governance.user_mfa SET failed_attempts = $2,
       locked_until = ${lock ? `CURRENT_TIMESTAMP + interval '${LOCK_MINUTES} minutes'` : "locked_until"},
       updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [userId, lock ? 0 : failed]
  );
  return lock;
}

/*
 * Verify the second factor at login. Accepts a 6-digit TOTP or a recovery code.
 * Enforces a lockout after MAX_ATTEMPTS consecutive failures. Returns
 * { ok, method } on success; { ok:false, locked?, until? } otherwise.
 */
export async function verifyForLogin(userId, code) {
  const row = await getRow(userId);
  if (!row || !row.enabled) return { ok: false };
  if (row.locked_until && new Date(row.locked_until) > new Date()) return lockedResponse(row);

  const norm = normalizeCode(code);
  if (/^\d{6}$/.test(norm)) {
    const secret = decryptSecret(row.secret_enc);
    const res = verifyTotp(secret, norm, Math.floor(Date.now() / 1000), { window: 1, lastStep: row.last_step });
    if (res.ok) {
      await query(
        `UPDATE governance.user_mfa SET last_step = $2, failed_attempts = 0, locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
        [userId, res.step]
      );
      return { ok: true, method: "totp" };
    }
    const locked = await registerFailure(userId, row);
    return locked ? { ok: false, locked: true } : { ok: false };
  }

  // Otherwise treat it as a recovery code.
  const target = normRecovery(code);
  if (target.length >= 8) {
    const { rows } = await query(
      `SELECT id, code_hash FROM governance.mfa_recovery_code WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
    for (const r of rows) {
      if (await bcrypt.compare(target, r.code_hash)) {
        await query(`UPDATE governance.mfa_recovery_code SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [r.id]);
        await query(
          `UPDATE governance.user_mfa SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
          [userId]
        );
        return { ok: true, method: "recovery" };
      }
    }
  }
  const locked = await registerFailure(userId, row);
  return locked ? { ok: false, locked: true } : { ok: false };
}

// Turn MFA off after re-authenticating with a current code (TOTP or recovery).
export async function disableMfa(userId, code, actor) {
  const row = await getRow(userId);
  if (!row || !row.enabled) return { ok: true }; // already off
  const check = await verifyForLogin(userId, code);
  if (!check.ok) throw check.locked ? new Error("Too many attempts — locked for a few minutes") : new Error("That code didn't match");
  await query(`DELETE FROM governance.user_mfa WHERE user_id = $1`, [userId]); // recovery codes cascade
  await audit({ actor, eventType: "mfa.disable", objectType: "users", objectRef: String(userId) });
  return { ok: true };
}

// Replace the recovery codes after re-authenticating with a code.
export async function regenerateRecovery(userId, code, actor) {
  const check = await verifyForLogin(userId, code);
  if (!check.ok) throw check.locked ? new Error("Too many attempts — locked for a few minutes") : new Error("That code didn't match");
  const recoveryCodes = await resetRecoveryCodes(userId);
  await audit({ actor, eventType: "mfa.recovery.regenerate", objectType: "users", objectRef: String(userId) });
  return { recoveryCodes };
}

// Admin escape hatch: clear a user's MFA entirely (lost device and codes).
export async function clearMfaForUser(userId, actor) {
  await query(`DELETE FROM governance.user_mfa WHERE user_id = $1`, [userId]); // recovery cascade
  await audit({ actor, eventType: "mfa.admin.clear", objectType: "users", objectRef: String(userId) });
  return { ok: true };
}
