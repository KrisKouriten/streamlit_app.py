import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teeUploadAction, teeUploadDepartments, employeeKey, findEmployeeBudget, teeLevel } from "../lib/tee-budget-rules.js";

test("an upload creates or fills a draft, and never touches a budget submitted for approval", () => {
  assert.deepEqual(teeUploadAction(null), { action: "CREATE" });
  assert.deepEqual(teeUploadAction({ status: "DRAFT" }), { action: "FILL" });
  for (const status of ["FINANCE_REVIEW", "DEPT_APPROVAL", "SLT_APPROVAL", "LOCKED"]) {
    const a = teeUploadAction({ status });
    assert.equal(a.action, "LOCKED", status);
    assert.match(a.reason, /return it to draft/);
    assert.match(a.reason, /approving again/);
  }
  assert.match(teeUploadAction({ status: "LOCKED" }).reason, /approved and locked/);
});

test("Finance load every department; anyone else their own and the ones they head", () => {
  const departments = ["Finance", "HR", "Marketing", "Operations"];
  assert.deepEqual(teeUploadDepartments({ isFinance: true, departments }), departments);
  assert.deepEqual(teeUploadDepartments({ headed: ["Marketing"], myDept: "HR", departments }), ["HR", "Marketing"]);
  assert.deepEqual(teeUploadDepartments({ headed: [], myDept: null, departments }), []);
  assert.deepEqual(teeUploadDepartments({ headed: ["Not a department"], departments }), []);
});

test("employees match their claims however the name is written", () => {
  assert.equal(employeeKey("Saad Usman (saad@x.com)"), "saad usman");
  assert.equal(employeeKey("  Alex   Norgate "), "alex norgate");
  const split = [{ employee: "Alex Norgate", total: 1200 }, { employee: "Unallocated", total: 50 }];
  assert.equal(findEmployeeBudget(split, "alex norgate (a@x.com)").total, 1200);
  assert.equal(findEmployeeBudget(split, "Sam Other"), null);
  assert.equal(findEmployeeBudget(split, ""), null);
  assert.equal(teeLevel(split), "EMPLOYEE");
  assert.equal(teeLevel([]), "DEPARTMENT");
});

test("the in-app employee table is migration 118's own statement", () => {
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  const src = readFileSync(new URL("../lib/tee-employee.js", import.meta.url), "utf8");
  const sql = src.slice(src.indexOf("`CREATE TABLE") + 1, src.indexOf(")`;") + 1);
  const mig = readFileSync(new URL("../db/migrations/118_tee_budget_employee.sql", import.meta.url), "utf8");
  assert.ok(sql.startsWith("CREATE TABLE IF NOT EXISTS finance.tee_budget_employee"));
  assert.ok(norm(mig).includes(norm(sql)), "TEE_EMPLOYEE_SQL must match the migration");
});
