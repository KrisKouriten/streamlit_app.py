import test from "node:test";
import assert from "node:assert/strict";
import { reviewError, validateOutput, DECISIONS, LIFECYCLE } from "../lib/agent-rules.js";

const reviewer = { roles: ["FINANCE"] };
const nonReviewer = { roles: ["OPS"] };
const out = (over = {}) => ({ lifecycle: "PENDING_REVIEW", ...over });

test("reviewer can approve a pending output", () => {
  assert.equal(reviewError("approve", out(), reviewer), null);
});
test("non-reviewer role cannot decide", () => {
  assert.match(reviewError("approve", out(), nonReviewer), /Reviewer access/);
});
test("cannot approve an already-approved output", () => {
  assert.match(reviewError("approve", out({ lifecycle: "APPROVED" }), reviewer), /Cannot approve/);
});
test("amend requires changed content", () => {
  assert.match(reviewError("amend", out(), reviewer), /must change/);
  assert.equal(reviewError("amend", out({ amended_headline: "New headline" }), reviewer), null);
});
test("close only after a decision", () => {
  assert.match(reviewError("close", out(), reviewer), /Cannot close/);
  assert.equal(reviewError("close", out({ lifecycle: "APPROVED" }), reviewer), null);
});
test("all decision targets are valid lifecycle states", () => {
  for (const rule of Object.values(DECISIONS)) {
    assert.ok(LIFECYCLE.includes(rule.to));
    for (const f of rule.from) assert.ok(LIFECYCLE.includes(f));
  }
});
test("validation catches structural problems", () => {
  assert.match(validateOutput({ headline: "", body: "x" }), /FAILED.*headline/);
  assert.match(validateOutput({ headline: "h", body: "b", confidence_pct: 2 }), /FAILED.*confidence/);
  assert.match(validateOutput({ headline: "h", body: "b", financial_impact: 100, confidence_pct: 0.9 }), /PASSED/);
});
