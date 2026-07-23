import test from "node:test";
import assert from "node:assert/strict";
import { isLocked, registerFailure, LOGIN_THRESHOLD, LOGIN_WINDOW_MS, LOGIN_LOCK_MS } from "../lib/login-throttle-rules.js";

const NOW = 1_700_000_000_000;

test("isLocked reflects locked_until vs now", () => {
  assert.equal(isLocked({ locked_until: NOW + 1000 }, NOW), true);
  assert.equal(isLocked({ locked_until: NOW - 1000 }, NOW), false);
  assert.equal(isLocked({ locked_until: null }, NOW), false);
  assert.equal(isLocked(null, NOW), false);
});

test("first failure opens a window with one attempt", () => {
  const r = registerFailure(null, NOW);
  assert.equal(r.attempts, 1);
  assert.equal(r.firstAtMs, NOW);
  assert.equal(r.locked, false);
});

test("failures inside the window accumulate", () => {
  let row = { attempts: 1, first_attempt_at: NOW, locked_until: null };
  const r = registerFailure(row, NOW + 1000);
  assert.equal(r.attempts, 2);
  assert.equal(r.firstAtMs, NOW); // window anchor unchanged
});

test("a stale window resets to a single attempt", () => {
  const row = { attempts: 5, first_attempt_at: NOW, locked_until: null };
  const r = registerFailure(row, NOW + LOGIN_WINDOW_MS + 1);
  assert.equal(r.attempts, 1);
  assert.equal(r.firstAtMs, NOW + LOGIN_WINDOW_MS + 1);
});

test("hitting the threshold locks and resets the counter", () => {
  const row = { attempts: LOGIN_THRESHOLD - 1, first_attempt_at: NOW, locked_until: null };
  const r = registerFailure(row, NOW + 1000);
  assert.equal(r.locked, true);
  assert.equal(r.lockedUntilMs, NOW + 1000 + LOGIN_LOCK_MS);
  assert.equal(r.attempts, 0);
  assert.equal(r.firstAtMs, null);
});

test("threshold is not tripped one attempt early", () => {
  const row = { attempts: LOGIN_THRESHOLD - 2, first_attempt_at: NOW, locked_until: null };
  const r = registerFailure(row, NOW + 1000);
  assert.equal(r.locked, false);
  assert.equal(r.attempts, LOGIN_THRESHOLD - 1);
});
