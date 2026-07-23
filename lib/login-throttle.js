import { query } from "./db";
import { isLocked, registerFailure } from "./login-throttle-rules.js";

/*
 * Login throttle — DB layer. State lives in governance.login_attempt (keyed by
 * lowercased email) so it works across serverless instances. Decisions come from
 * login-throttle-rules.js. Never throws on a missing table (migration 030 not
 * run yet just means "no throttling").
 */

const tableMissing = (e) => e?.code === "42P01";
const norm = (email) => String(email || "").toLowerCase().trim();

// Is sign-in currently locked for this email? Returns { locked, until }.
export async function checkLoginThrottle(email) {
  const id = norm(email);
  if (!id) return { locked: false };
  try {
    const { rows } = await query(`SELECT attempts, first_attempt_at, locked_until FROM governance.login_attempt WHERE identifier = $1`, [id]);
    const row = rows[0];
    const until = isLocked(row, Date.now()) ? row.locked_until : null;
    return { locked: !!until, until };
  } catch (e) {
    if (tableMissing(e)) return { locked: false };
    throw e;
  }
}

// Record a failed sign-in and return the new lock state { locked, until }.
export async function recordLoginFailure(email) {
  const id = norm(email);
  if (!id) return { locked: false };
  try {
    const { rows } = await query(`SELECT attempts, first_attempt_at, locked_until FROM governance.login_attempt WHERE identifier = $1`, [id]);
    const now = Date.now();
    const next = registerFailure(rows[0] || null, now);
    await query(
      `INSERT INTO governance.login_attempt (identifier, attempts, first_attempt_at, last_attempt_at, locked_until)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (identifier) DO UPDATE SET attempts = EXCLUDED.attempts, first_attempt_at = EXCLUDED.first_attempt_at,
         last_attempt_at = EXCLUDED.last_attempt_at, locked_until = EXCLUDED.locked_until`,
      [id, next.attempts, next.firstAtMs ? new Date(next.firstAtMs) : null, new Date(now), next.lockedUntilMs ? new Date(next.lockedUntilMs) : null]
    );
    return { locked: next.locked, until: next.lockedUntilMs ? new Date(next.lockedUntilMs) : null };
  } catch (e) {
    if (tableMissing(e)) return { locked: false };
    throw e;
  }
}

// Clear the throttle after a successful sign-in.
export async function clearLoginThrottle(email) {
  const id = norm(email);
  if (!id) return;
  try {
    await query(`DELETE FROM governance.login_attempt WHERE identifier = $1`, [id]);
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }
}
