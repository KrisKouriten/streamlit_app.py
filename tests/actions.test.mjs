import test from "node:test";
import assert from "node:assert/strict";
import { actionTransitionError, ACTION_TRANSITIONS, ACTION_STATUSES } from "../lib/action-rules.js";

const owner = { isOwner: true, isManager: false, canClose: false };
const manager = { isOwner: false, isManager: true, canClose: true };
const exec = { isOwner: false, isManager: false, canClose: true };
const bystander = { isOwner: false, isManager: false, canClose: false };

test("owner can start their open action", () => {
  assert.equal(actionTransitionError("start", "OPEN", owner), null);
});
test("bystander cannot start", () => {
  assert.match(actionTransitionError("start", "OPEN", bystander), /owner or a manager/);
});
test("completion is allowed for the owner", () => {
  assert.equal(actionTransitionError("complete", "IN_PROGRESS", owner), null);
});
test("owner without closer rights cannot approve closure", () => {
  assert.match(actionTransitionError("close", "COMPLETE", owner), /ADMIN, FINANCE or EXEC/);
});
test("exec can approve closure of a completed action", () => {
  assert.equal(actionTransitionError("close", "COMPLETE", exec), null);
});
test("cannot close an action that is not complete", () => {
  assert.match(actionTransitionError("close", "IN_PROGRESS", manager), /Cannot close/);
});
test("only a manager can cancel", () => {
  assert.match(actionTransitionError("cancel", "OPEN", owner), /Manager access/);
  assert.equal(actionTransitionError("cancel", "OPEN", manager), null);
});
test("closed is terminal", () => {
  for (const a of Object.keys(ACTION_TRANSITIONS)) assert.match(actionTransitionError(a, "CLOSED", manager), /Cannot/);
});
test("all transition targets are valid statuses", () => {
  for (const r of Object.values(ACTION_TRANSITIONS)) {
    assert.ok(ACTION_STATUSES.includes(r.to));
    for (const f of r.from) assert.ok(ACTION_STATUSES.includes(f));
  }
});
