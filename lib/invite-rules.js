/*
 * Pure rules for email invites and the self-service "set your password" flow.
 * No I/O — token generation, hashing and DB access live in lib/invite.js; this
 * file holds only the decisions both the API and the tests lean on.
 */

import { MIN_LENGTH } from "./password-rules.js";

// How long an invite / reset link stays usable.
export const INVITE_TTL_HOURS = 48;

/*
 * Is an invite row still redeemable? Mirrors the shape of session-rules:
 * pass the row (or null) and the current epoch-ms, get back { valid, reason }.
 *  - missing   no such token
 *  - used      already redeemed (single-use)
 *  - expired   past its expires_at
 */
export function inviteTokenState(row, nowMs = Date.now()) {
  if (!row) return { valid: false, reason: "missing" };
  if (row.used_at) return { valid: false, reason: "used" };
  const expires = row.expires_at instanceof Date ? row.expires_at.getTime() : new Date(row.expires_at).getTime();
  if (!Number.isFinite(expires) || expires <= nowMs) return { valid: false, reason: "expired" };
  return { valid: true, reason: "ok" };
}

// A human-facing line for an unusable link, so the page and the API agree.
export function inviteProblemMessage(reason) {
  switch (reason) {
    case "used":
      return "This link has already been used. Ask an administrator for a fresh one.";
    case "expired":
      return "This link has expired. Ask an administrator to send a new one.";
    default:
      return "This link is not valid. Ask an administrator to send a new one.";
  }
}

/*
 * Validate a brand-new password being set via an invite/reset link. Unlike a
 * self-service change there is no "current" password to prove or differ from —
 * just length and a matching confirmation. Reuses the shared MIN_LENGTH.
 */
export function validateNewPassword({ next, confirm } = {}) {
  if (!next) return { ok: false, error: "Enter a new password" };
  if (next.length < MIN_LENGTH) return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters` };
  if (confirm !== undefined && confirm !== next) return { ok: false, error: "Password and confirmation do not match" };
  return { ok: true };
}

/*
 * Work out the app's public base URL for building an email link. Order of
 * preference:
 *   1. APP_BASE_URL              explicit override (best; set once in prod)
 *   2. the request origin        reliable on Vercel preview + prod deploys
 *   3. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL   Vercel-provided hostnames
 * Returns a normalised origin with no trailing slash, or null if nothing known.
 */
export function resolveBaseUrl({ origin, env = {} } = {}) {
  const clean = (u) => (u ? String(u).replace(/\/+$/, "") : null);
  if (env.APP_BASE_URL) return clean(env.APP_BASE_URL);
  if (origin) return clean(origin);
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (host) return clean(host.startsWith("http") ? host : `https://${host}`);
  return null;
}

// The public link a user follows to set their password.
export function setPasswordLink(baseUrl, rawToken) {
  const base = baseUrl ? String(baseUrl).replace(/\/+$/, "") : "";
  return `${base}/set-password?token=${encodeURIComponent(rawToken)}`;
}
