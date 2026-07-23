/*
 * TOTP (RFC 6238) + base32 (RFC 4648) — the deterministic core of two-step
 * sign-in, kept in one place and tested against the RFC test vectors. Uses
 * node:crypto for HMAC/constant-time compare (a built-in, so this stays pure of
 * app/DB imports and fully unit-testable). Google Authenticator / Authy
 * defaults: HMAC-SHA1, 6 digits, 30-second step.
 */

import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP = 30;
export const DIGITS = 6;

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue; // skip padding, spaces, separators
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// Strip the spaces and dashes people type; leave the digits.
export function normalizeCode(code) {
  return String(code || "").replace(/[\s-]/g, "");
}

// HOTP (RFC 4226) for a counter and key bytes.
export function hotp(keyBytes, counter, digits = DIGITS) {
  const buf = Buffer.alloc(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { buf[i] = Number(c & 0xffn); c >>= 8n; }
  const hmac = crypto.createHmac("sha1", keyBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function timeStep(timeSec, step = STEP) {
  return Math.floor(timeSec / step);
}

// The current TOTP for a base32 secret at a given wall-clock time (seconds).
export function totp(secretBase32, timeSec, { step = STEP, digits = DIGITS } = {}) {
  return hotp(base32Decode(secretBase32), timeStep(timeSec, step), digits);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/*
 * Verify a submitted code against the secret, allowing ±window steps of clock
 * drift. lastStep, if given, is the highest time-step already accepted for this
 * secret — any step at or below it is refused, so a code cannot be replayed
 * within its validity window. Returns { ok, step } where step is the matched
 * time-step (persist it as the new lastStep on success).
 */
export function verifyTotp(secretBase32, code, timeSec, { step = STEP, digits = DIGITS, window = 1, lastStep = null } = {}) {
  const norm = normalizeCode(code);
  if (!new RegExp(`^\\d{${digits}}$`).test(norm)) return { ok: false, step: null };
  const key = base32Decode(secretBase32);
  const current = timeStep(timeSec, step);
  for (let w = -window; w <= window; w++) {
    const c = current + w;
    if (c < 0) continue;
    if (lastStep != null && c <= lastStep) continue; // replay / reuse guard
    if (timingSafeEqualStr(hotp(key, c, digits), norm)) return { ok: true, step: c };
  }
  return { ok: false, step: null };
}

// Build the otpauth:// URI an authenticator app imports (issuer + account).
export function otpauthUri({ secret, account, issuer = "Miniso UK Finance OS", digits = DIGITS, step = STEP }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(digits), period: String(step) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
