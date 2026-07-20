import test from "node:test";
import assert from "node:assert/strict";
import { transitionError, TRANSITIONS, STATUSES } from "../lib/workflow-rules.js";

const assignee = { id: 1, roles: ["OPS"] };
const manager = { id: 2, roles: ["FINANCE"] };
const reviewer = { id: 3, roles: ["EXEC"] };

const task = (over = {}) => ({ status: "IN_PROGRESS", assigned_to: 1, reviewer_id: 3, requires_review: true, ...over });

test("assignee can submit their in-progress task", () => {
  assert.equal(transitionError("submit", task(), assignee), null);
});
test("assignee cannot mark a review-required task complete", () => {
  assert.match(transitionError("complete", task(), assignee), /requires reviewer approval/);
});
test("assignee can complete when no review required", () => {
  assert.equal(transitionError("complete", task({ requires_review: false }), assignee), null);
});
test("someone else cannot work another person's task", () => {
  assert.match(transitionError("submit", task(), reviewer), /Only the assignee/);
});
test("manager can act on anyone's task", () => {
  assert.equal(transitionError("submit", task(), manager), null);
});
test("named reviewer can approve a submitted task", () => {
  assert.equal(transitionError("approve", task({ status: "READY_FOR_REVIEW" }), reviewer), null);
});
test("assignee cannot approve their own submission", () => {
  const t = task({ status: "READY_FOR_REVIEW", assigned_to: 2, reviewer_id: null });
  assert.match(transitionError("approve", t, manager), /own task/);
});
test("cannot approve a task that is not ready for review", () => {
  assert.match(transitionError("approve", task(), reviewer), /Cannot approve/);
});
test("non-manager cannot cancel", () => {
  assert.match(transitionError("cancel", task(), assignee), /Manager access/);
});
test("all transition targets are valid statuses", () => {
  for (const rule of Object.values(TRANSITIONS)) {
    assert.ok(STATUSES.includes(rule.to));
    for (const f of rule.from) assert.ok(STATUSES.includes(f));
  }
});
