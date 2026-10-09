import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProject, projectDeleteError, projectDateLabel, isoDate } from "../lib/business-projects-rules.js";

test("dates: planned start and target finish; target month follows the finish date", () => {
  const { clean, errors } = validateProject({ name: "X", start_date: "2026-10-01", target_date: "2027-03-31" });
  assert.deepEqual(errors, []);
  assert.equal(clean.start_date, "2026-10-01");
  assert.equal(clean.target_date, "2027-03-31");
  assert.equal(clean.target_ym, "2027-03");
});

test("dates: finish before start, or a date that doesn't exist, is refused", () => {
  assert.match(validateProject({ name: "X", start_date: "2026-11-01", target_date: "2026-10-01" }).errors.join(), /before the planned start/);
  assert.match(validateProject({ name: "X", target_date: "2026-02-31" }).errors.join(), /isn't a real date/);
  assert.equal(isoDate("2026-02-31"), null);
  assert.equal(isoDate("2026-02-28T00:00:00.000Z"), "2026-02-28");
});

test("dates: a project saved before the dates keeps its target month until a finish date is set", () => {
  assert.equal(validateProject({ name: "X", target_ym: "2026-09" }).clean.target_ym, "2026-09");
  assert.equal(validateProject({ name: "X", target_ym: "2026-09", target_date: "2026-12-15" }).clean.target_ym, "2026-12");
  assert.equal(validateProject({ name: "X" }).clean.target_ym, null);
  assert.equal(projectDateLabel("2026-12-15"), "15/12/2026");
  assert.equal(projectDateLabel(null, "2026-09"), "Sep 2026");
  assert.equal(projectDateLabel(null), "—");
});

test("delete: whoever set it up, or Finance; never while P.Os or budgets point at it", () => {
  const p = { created_by: "kris@x.co" };
  assert.equal(projectDeleteError(p, {}, { actor: "KRIS@x.co", canManage: false }), null);
  assert.equal(projectDeleteError(p, {}, { actor: "fin@x.co", canManage: true }), null);
  assert.match(projectDeleteError(p, {}, { actor: "sam@x.co", canManage: false }), /Only whoever set the project up/);
  assert.match(projectDeleteError({ created_by: null }, {}, { actor: "sam@x.co" }), /Only whoever/);
  assert.match(projectDeleteError(p, { pos: 2 }, { actor: "kris@x.co" }), /2 P\.Os are tagged/);
  assert.match(projectDeleteError(p, { pos: 1 }, { canManage: true }), /1 P\.O is tagged/);
  assert.match(projectDeleteError(p, { budgets: 1 }, { canManage: true }), /departmental budget is set against/);
});
