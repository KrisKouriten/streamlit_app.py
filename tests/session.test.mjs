import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  RENEW_THRESHOLD_MS,
  toMs,
  computeExpiry,
  sessionValidity,
  shouldRenewLastSeen,
} from "../lib/session-rules.js";

const NOW = 1_700_000_000_000; // fixed clock

function row(overrides = {}) {
  return {
    created_at: NOW,
    last_seen_at: NOW,
    expires_at: NOW + SESSION_ABSOLUTE_MS,
    revoked_at: null,
    ...overrides,
  };
}

test("toMs accepts Date, number, ISO string and nullish", () => {
  assert.equal(toMs(NOW), NOW);
  assert.equal(toMs(new Date(NOW)), NOW);
  assert.equal(toMs(new Date(NOW).toISOString()), NOW);
  assert.equal(toMs(null), null);
  assert.equal(toMs(undefined), null);
  assert.equal(toMs("not a date"), null);
});

test("computeExpiry is creation plus the absolute window", () => {
  assert.equal(computeExpiry(NOW), NOW + SESSION_ABSOLUTE_MS);
});

test("a fresh session is valid", () => {
  assert.deepEqual(sessionValidity(row(), NOW), { valid: true, reason: null });
});

test("a revoked session is invalid even inside every window", () => {
  const r = row({ revoked_at: NOW - 1000 });
  assert.deepEqual(sessionValidity(r, NOW), { valid: false, reason: "revoked" });
});

test("a session past its absolute expiry is invalid", () => {
  const r = row();
  assert.deepEqual(sessionValidity(r, NOW + SESSION_ABSOLUTE_MS), { valid: false, reason: "expired" });
  assert.deepEqual(sessionValidity(r, NOW + SESSION_ABSOLUTE_MS + 1), { valid: false, reason: "expired" });
});

test("a session idle past the idle window is invalid", () => {
  const r = row({ last_seen_at: NOW - SESSION_IDLE_MS });
  assert.equal(sessionValidity(r, NOW).valid, false);
  assert.equal(sessionValidity(r, NOW).reason, "idle");
});

test("idle takes effect before absolute when the user goes quiet", () => {
  // Active 1 minute ago, well inside both windows.
  const r = row({ last_seen_at: NOW - 60_000 });
  assert.equal(sessionValidity(r, NOW).valid, true);
});

test("revoked beats expired and idle in reason precedence", () => {
  const r = row({ revoked_at: NOW - 1, last_seen_at: NOW - SESSION_IDLE_MS, expires_at: NOW - 1 });
  assert.equal(sessionValidity(r, NOW).reason, "revoked");
});

test("malformed rows are rejected, not trusted", () => {
  assert.equal(sessionValidity(null, NOW).reason, "malformed");
  assert.equal(sessionValidity({ last_seen_at: null, expires_at: NOW }, NOW).reason, "malformed");
  assert.equal(sessionValidity({ last_seen_at: NOW, expires_at: null }, NOW).reason, "malformed");
});

test("shouldRenewLastSeen coalesces frequent activity", () => {
  assert.equal(shouldRenewLastSeen(NOW, NOW), false);
  assert.equal(shouldRenewLastSeen(NOW, NOW + RENEW_THRESHOLD_MS - 1), false);
  assert.equal(shouldRenewLastSeen(NOW, NOW + RENEW_THRESHOLD_MS), true);
  assert.equal(shouldRenewLastSeen(null, NOW), true);
});
