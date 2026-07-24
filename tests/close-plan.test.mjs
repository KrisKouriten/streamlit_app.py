import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlan, evaluateStep, readinessLabel, CLOSE_STEPS } from "../lib/close-plan-rules.js";

// A fully-clean set of signals — every AUTO gate satisfied, period open.
function cleanSignals() {
  return {
    period: "2026-06",
    actuals: { loaded: true, rows: 420, revenue: 1000000 },
    freshness: { ageDays: 2, source: "joiin-api", ok: true },
    preclose: { ready: true, total: 3, high: 0, unresolvedHigh: 0, unresolved: 0, reviewed: 3, assured: 40 },
    playbook: { PL: { done: 6, total: 6 }, ACCRUALS: { done: 6, total: 6 }, FA: { done: 6, total: 6 } },
    tasks: { open: 0, overdueCritical: 0, total: 12 },
    commentary: { exists: true, approved: true },
    locked: false,
  };
}

test("auto-clean signals leave only the two manual sign-offs outstanding", () => {
  const plan = evaluatePlan(cleanSignals());
  // Every AUTO gate passes; the two MANUAL sign-offs are still pending.
  assert.deepEqual(plan.blockers.map((b) => b.code).sort(), ["board_pack", "variance_reviewed"]);
  assert.equal(plan.ready, false);
  assert.equal(plan.locked, false);
  // 9 of 11 gate steps satisfied → 82.
  assert.equal(plan.score, 82);
  // period_locked is excluded from the gate, so it is never a blocker.
  assert.ok(!plan.blockers.some((b) => b.code === "period_locked"));
});

test("failing AUTO checks become blockers and drop the score", () => {
  const s = cleanSignals();
  s.actuals = { loaded: false, rows: 0 };
  s.preclose.unresolvedHigh = 2;
  s.preclose.unresolved = 3;
  const plan = evaluatePlan(s);
  const codes = plan.blockers.map((b) => b.code);
  assert.ok(codes.includes("actuals_loaded"));
  assert.ok(codes.includes("preclose_clear"));
  assert.ok(codes.includes("preclose_reviewed"));
  assert.equal(plan.ready, false);
  assert.ok(plan.score < 100);
  assert.match(readinessLabel(plan), /outstanding/);
});

test("stale feed beyond tolerance blocks feed_fresh", () => {
  const s = cleanSignals();
  s.freshness = { ageDays: 40, source: "joiin-api" };
  const plan = evaluatePlan(s);
  assert.ok(plan.blockers.some((b) => b.code === "feed_fresh"));
});

test("MANUAL steps are PENDING until a human signs them off", () => {
  const plan = evaluatePlan(cleanSignals());
  const variance = plan.steps.find((s) => s.code === "variance_reviewed");
  const board = plan.steps.find((s) => s.code === "board_pack");
  assert.equal(variance.status, "PENDING");
  assert.equal(board.status, "PENDING");
  // Because two MANUAL gates are pending, the "clean" period above is NOT
  // actually ready — adjust expectation: cleanSignals leaves manuals pending.
  assert.ok(plan.blockers.some((b) => b.code === "variance_reviewed"));
});

test("an override to DONE satisfies a MANUAL step; NA waives it", () => {
  const overrides = {
    variance_reviewed: { status: "DONE", actor: "kris@kouriten.com", at: "2026-07-01T00:00:00Z" },
    board_pack: { status: "NA", note: "no board this month" },
  };
  const plan = evaluatePlan(cleanSignals(), overrides);
  assert.equal(plan.steps.find((s) => s.code === "variance_reviewed").status, "DONE");
  assert.equal(plan.steps.find((s) => s.code === "board_pack").status, "NA");
  assert.equal(plan.ready, true); // all gates now satisfied
});

test("an override to DONE wins over a failing AUTO check (waiver)", () => {
  const s = cleanSignals();
  s.freshness = { ageDays: 99, source: "joiin-api" };
  const overridden = evaluateStep(
    CLOSE_STEPS.find((x) => x.code === "feed_fresh"),
    s,
    { status: "DONE", actor: "kris", note: "manual load verified" }
  );
  assert.equal(overridden.status, "DONE");
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.by, "kris");
});

test("playbook with no configured actions is NA, never a blocker", () => {
  const s = cleanSignals();
  s.playbook = { PL: { done: 0, total: 0 }, ACCRUALS: { done: 0, total: 0 }, FA: { done: 0, total: 0 } };
  const plan = evaluatePlan(s);
  assert.equal(plan.steps.find((x) => x.code === "pl_playbook").status, "NA");
  assert.ok(!plan.blockers.some((b) => b.code === "pl_playbook"));
});

test("pre-close not configured (no migration 012) is NA, not a blocker", () => {
  const s = cleanSignals();
  s.preclose = { ready: false };
  const plan = evaluatePlan(s);
  assert.equal(plan.steps.find((x) => x.code === "preclose_clear").status, "NA");
  assert.ok(!plan.blockers.some((b) => b.code === "preclose_clear"));
});

test("locked period reports locked and labels as Locked", () => {
  const overrides = {
    variance_reviewed: { status: "DONE" },
    board_pack: { status: "DONE" },
  };
  const s = cleanSignals();
  s.locked = true;
  const plan = evaluatePlan(s, overrides);
  assert.equal(plan.locked, true);
  assert.equal(readinessLabel(plan), "Locked");
  assert.equal(plan.steps.find((x) => x.code === "period_locked").status, "PASS");
});
