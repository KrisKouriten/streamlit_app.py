import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReport } from "../lib/reporting/validation-rules.js";

const NOW = Date.parse("2026-07-27T00:00:00Z");

function healthyReport() {
  return {
    status: "IN_REVIEW", confidentiality: "INTERNAL", reviewer: "a@x", approver: "b@x",
    comparator: "LATEST_FORECAST", data_through_date: "2026-07-26", reporting_period: "2026-W30",
  };
}
const healthySections = [
  { section_key: "cover", title: "Cover", included: true, mandatory: true, data_status: "READY", commentary_status: "NONE" },
  { section_key: "exec_summary", title: "Executive Summary", included: true, mandatory: true, data_status: "READY", commentary_status: "APPROVED" },
  { section_key: "sales", title: "Sales", included: true, mandatory: false, data_status: "READY", commentary_status: "NONE" },
];
const healthyComponents = [
  { component_type: "commentary", ai_status: "APPROVED" },
  { component_type: "table", source_key: "store_sales" },
];

test("a complete, fresh, reviewed report passes and can be issued", () => {
  const r = validateReport(healthyReport(), healthySections, healthyComponents, { nowMs: NOW });
  assert.equal(r.overall, "PASSED");
  assert.equal(r.canIssue, true);
  assert.equal(r.summary.failed, 0);
});

test("missing mandatory section fails and blocks issue", () => {
  const sections = healthySections.map((s) => (s.section_key === "exec_summary" ? { ...s, included: false } : s));
  const r = validateReport(healthyReport(), sections, healthyComponents, { nowMs: NOW });
  assert.equal(r.overall, "FAILED");
  assert.equal(r.canIssue, false);
  assert.ok(r.checks.find((c) => c.key === "mandatory_sections" && c.level === "FAILED"));
});

test("an unreviewed AI commentary draft fails validation (cannot be issued)", () => {
  const comps = [{ component_type: "commentary", ai_status: "DRAFT" }];
  const r = validateReport(healthyReport(), healthySections, comps, { nowMs: NOW });
  assert.equal(r.canIssue, false);
  const chk = r.checks.find((c) => c.key === "commentary_reviewed");
  assert.equal(chk.level, "FAILED");
});

test("stale data raises a warning, not a failure", () => {
  const r = validateReport({ ...healthyReport(), data_through_date: "2026-06-01" }, healthySections, healthyComponents, { nowMs: NOW });
  const chk = r.checks.find((c) => c.key === "data_freshness");
  assert.equal(chk.level, "WARNING");
  assert.equal(r.canIssue, true); // warnings do not block
});

test("missing section data fails", () => {
  const sections = healthySections.map((s) => (s.section_key === "sales" ? { ...s, data_status: "MISSING" } : s));
  const r = validateReport(healthyReport(), sections, healthyComponents, { nowMs: NOW });
  assert.equal(r.checks.find((c) => c.key === "data_available").level, "FAILED");
});

test("missing confidentiality fails; missing reviewer/approver warn", () => {
  const r = validateReport(
    { ...healthyReport(), confidentiality: null, reviewer: null, approver: null },
    healthySections, healthyComponents, { nowMs: NOW });
  assert.equal(r.checks.find((c) => c.key === "confidentiality").level, "FAILED");
  assert.equal(r.checks.find((c) => c.key === "reviewer").level, "WARNING");
  assert.equal(r.checks.find((c) => c.key === "approver").level, "WARNING");
});
