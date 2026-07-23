/*
 * Login throttle rules — pure, import-free, unit-tested. Brakes password
 * brute-force at the sign-in step (the MFA step has its own lockout). Keyed by
 * email: after THRESHOLD failures inside a rolling WINDOW the account's sign-in
 * locks for LOCK. A successful sign-in clears the counter.
 *
 * Trade-off: per-email keying means someone could deliberately lock a known
 * account (a nuisance, not a breach) — acceptable for a small internal tool
 * where MFA is the real second factor and the window is short. The DB layer
 * applies these decisions; keeping them pure makes the thresholds testable.
 */

export const LOGIN_THRESHOLD = 8; // failures before a lock
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // rolling window the failures count within
export const LOGIN_LOCK_MS = 15 * 60 * 1000; // how long a lock lasts

function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Is sign-in currently locked for this row?
export function isLocked(row, nowMs) {
  const until = toMs(row?.locked_until);
  return until != null && until > nowMs;
}

/*
 * Compute the new throttle state after a failed sign-in.
 * row: existing { attempts, first_attempt_at, locked_until } or null.
 * Returns { attempts, firstAtMs, lockedUntilMs, locked } to persist.
 */
export function registerFailure(row, nowMs, opts = {}) {
  const threshold = opts.threshold ?? LOGIN_THRESHOLD;
  const windowMs = opts.windowMs ?? LOGIN_WINDOW_MS;
  const lockMs = opts.lockMs ?? LOGIN_LOCK_MS;

  const firstAt = toMs(row?.first_attempt_at);
  const prev = row?.attempts || 0;

  // Start a fresh window if there was none or the last one has elapsed.
  const windowActive = firstAt != null && nowMs - firstAt < windowMs;
  const attempts = windowActive ? prev + 1 : 1;
  const firstAtMs = windowActive ? firstAt : nowMs;

  if (attempts >= threshold) {
    // Lock, and reset the counter so the next window starts clean after the lock.
    return { attempts: 0, firstAtMs: null, lockedUntilMs: nowMs + lockMs, locked: true };
  }
  return { attempts, firstAtMs, lockedUntilMs: toMs(row?.locked_until), locked: false };
}
