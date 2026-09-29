import test from "node:test";
import assert from "node:assert/strict";
import { ALL_DEPTS, deptTabsFor, pickDeptTab, rowsForViewer, rowsForTab } from "../lib/dept-tabs-rules.js";

const pos = [
  { po_id: 1, department: "Marketing" }, { po_id: 2, department: "HR" }, { po_id: 3, department: "Operations" },
];

test("Finance see All departments plus a tab per department", () => {
  const tabs = deptTabsFor({ seeAll: true, departments: ["Marketing", "HR", "Operations", "HR"] });
  assert.deepEqual(tabs, [ALL_DEPTS, "HR", "Marketing", "Operations"]);
  assert.equal(rowsForViewer(pos, tabs).length, 3);
  assert.deepEqual(rowsForTab(pos, "HR").map((p) => p.po_id), [2]);
  assert.equal(rowsForTab(pos, ALL_DEPTS).length, 3);
});

test("Anyone else sees only their own departments, and never All", () => {
  const tabs = deptTabsFor({ seeAll: false, departments: ["Marketing", "HR", "Operations"], mine: ["Marketing", null, "Marketing", "Operations"] });
  assert.deepEqual(tabs, ["Marketing", "Operations"]);
  assert.deepEqual(rowsForViewer(pos, tabs).map((p) => p.po_id), [1, 3]);   // HR's P.O never reaches the browser
  assert.equal(pickDeptTab(ALL_DEPTS, tabs), "Marketing");
  assert.equal(pickDeptTab("Operations", tabs), "Operations");
  assert.equal(pickDeptTab("HR", tabs), "Marketing");
  assert.equal(pickDeptTab("HR", []), null);
  assert.deepEqual(rowsForViewer(pos, []), []);
});
