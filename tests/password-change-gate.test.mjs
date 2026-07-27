import { test } from "node:test";
import assert from "node:assert/strict";
import { mustChangePasswordGate } from "../lib/route-guards.js";

test("no gate when the session does not require a password change", () => {
  assert.equal(mustChangePasswordGate("/", false), false);
  assert.equal(mustChangePasswordGate("/dashboards/management-accounts", false), false);
});

test("gates ordinary app routes when a change is required", () => {
  assert.equal(mustChangePasswordGate("/", true), true);
  assert.equal(mustChangePasswordGate("/govern/users", true), true);
  assert.equal(mustChangePasswordGate("/api/admin/users", true), true);
});

test("does not gate the change-password screen or its endpoint", () => {
  assert.equal(mustChangePasswordGate("/change-password", true), false);
  assert.equal(mustChangePasswordGate("/api/account/first-password", true), false);
});

test("does not gate the escape hatches (sign out, identity probe)", () => {
  assert.equal(mustChangePasswordGate("/api/auth/logout", true), false);
  assert.equal(mustChangePasswordGate("/api/auth/me", true), false);
});

test("does not gate public routes (login, set-password) even if the flag is set", () => {
  assert.equal(mustChangePasswordGate("/login", true), false);
  assert.equal(mustChangePasswordGate("/set-password", true), false);
});
