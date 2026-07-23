import test from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, requiredRolesForPath, isAllowed, restrictedRoutes, ENFORCE_ROLE_GATES, originAllowed } from "../lib/route-guards.js";

test("auth handshake, health and the self-guarding cron are public", () => {
  for (const p of ["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/health", "/api/joiin-refresh"]) {
    assert.equal(isPublicPath(p), true, `${p} should be public`);
  }
});

test("ordinary app routes are not public", () => {
  for (const p of ["/", "/finance-os/executive", "/api/management-accounts", "/plan/scenarios"]) {
    assert.equal(isPublicPath(p), false, `${p} should not be public`);
  }
});

test("isAllowed: empty requirement allows anyone; otherwise needs an overlap", () => {
  assert.equal(isAllowed(["OPS"], null), true);
  assert.equal(isAllowed(["OPS"], []), true);
  assert.equal(isAllowed(["FINANCE"], ["ADMIN", "FINANCE"]), true);
  assert.equal(isAllowed(["OPS"], ["ADMIN", "FINANCE"]), false);
  assert.equal(isAllowed(undefined, ["FINANCE"]), false);
});

test("restricted routes are derived from the nav registry and finance-gated", () => {
  const routes = restrictedRoutes();
  // The Plan — Finance section carries restrictedTo ADMIN/FINANCE.
  assert.ok(routes.length > 0, "expected some restricted routes");
  const scenarios = routes.find((r) => r.path === "/plan/scenarios");
  assert.ok(scenarios, "/plan/scenarios should be a restricted route");
  assert.deepEqual(scenarios.roles, ["ADMIN", "FINANCE"]);
  // A placeholder item contributes its /module/<slug> route.
  assert.ok(routes.some((r) => r.path === "/module/budget-builder"));
});

test("originAllowed: same-origin passes, cross-origin fails, no-origin allowed", () => {
  const host = "finance.miniso.example";
  assert.equal(originAllowed(`https://${host}`, host), true); // same origin
  assert.equal(originAllowed(`https://${host}:443`.replace(":443", ""), host), true);
  assert.equal(originAllowed("https://evil.example", host), false); // cross-site
  assert.equal(originAllowed(null, host), true); // non-browser client (cron/server)
  assert.equal(originAllowed("", host), true); // absent
  assert.equal(originAllowed("not-a-url", host), false); // malformed → refuse
  assert.equal(originAllowed(`https://${host}`, "other.example"), false); // host mismatch
});

test("requiredRolesForPath respects the enforcement flag", () => {
  if (ENFORCE_ROLE_GATES) {
    assert.deepEqual(requiredRolesForPath("/plan/scenarios"), ["ADMIN", "FINANCE"]);
    assert.deepEqual(requiredRolesForPath("/plan/scenarios/sub"), ["ADMIN", "FINANCE"]);
    assert.equal(requiredRolesForPath("/finance-os/executive"), null);
  } else {
    // Held OFF by default — nothing is gated until a non-finance user exists.
    assert.equal(requiredRolesForPath("/plan/scenarios"), null);
    assert.equal(requiredRolesForPath("/finance-os/executive"), null);
  }
});
