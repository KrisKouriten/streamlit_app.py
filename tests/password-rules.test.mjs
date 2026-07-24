import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePasswordChange, MIN_LENGTH } from "../lib/password-rules.js";

test("rejects a missing current password", () => {
  const r = validatePasswordChange({ current: "", next: "longenough1", confirm: "longenough1" });
  assert.equal(r.ok, false);
  assert.match(r.error, /current password/i);
});

test("rejects a missing new password", () => {
  const r = validatePasswordChange({ current: "oldpass12", next: "", confirm: "" });
  assert.equal(r.ok, false);
  assert.match(r.error, /new password/i);
});

test("rejects a new password shorter than the minimum", () => {
  const short = "a".repeat(MIN_LENGTH - 1);
  const r = validatePasswordChange({ current: "oldpass12", next: short, confirm: short });
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(`${MIN_LENGTH} characters`));
});

test("rejects when the new password equals the current one", () => {
  const same = "samepass12";
  const r = validatePasswordChange({ current: same, next: same, confirm: same });
  assert.equal(r.ok, false);
  assert.match(r.error, /different/i);
});

test("rejects a confirmation mismatch", () => {
  const r = validatePasswordChange({ current: "oldpass12", next: "newpass123", confirm: "newpass124" });
  assert.equal(r.ok, false);
  assert.match(r.error, /do not match/i);
});

test("accepts a valid change with matching confirmation", () => {
  const r = validatePasswordChange({ current: "oldpass12", next: "newpass123", confirm: "newpass123" });
  assert.deepEqual(r, { ok: true });
});

test("accepts when confirm is omitted (API path validates match separately)", () => {
  const r = validatePasswordChange({ current: "oldpass12", next: "newpass123" });
  assert.equal(r.ok, true);
});
