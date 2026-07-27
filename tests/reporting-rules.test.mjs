import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_STATUSES, REPORT_TRANSITIONS, reportTransitionError, isEditable,
  validateReportInput, reorderSections, canExcludeSection,
  nextDraftLabel, approvedLabel, formatReportMoney, deriveDefaultTitle,
} from "../lib/reporting/reporting-rules.js";
import {
  PERSPECTIVES, isPerspective, defaultIncludeFor, buildReportContext,
  renderContextPreamble, DETAIL_LEVELS,
} from "../lib/reporting/commentary-perspectives.js";

test("every transition target is a known status", () => {
  for (const [action, t] of Object.entries(REPORT_TRANSITIONS)) {
    if (t.to !== null) assert.ok(REPORT_STATUSES.includes(t.to), `${action} → ${t.to}`);
    for (const f of t.from) assert.ok(REPORT_STATUSES.includes(f), `${action} from ${f}`);
  }
});

test("lifecycle: draft → review → approval → approved → issued", () => {
  assert.equal(reportTransitionError("submit_for_review", "DRAFT"), null);
  assert.equal(reportTransitionError("start_review", "REVIEW_READY"), null);
  assert.equal(reportTransitionError("ready_for_approval", "IN_REVIEW"), null);
  assert.equal(reportTransitionError("approve", "APPROVAL_READY"), null);
  assert.equal(reportTransitionError("issue", "APPROVED"), null);
});

test("illegal transitions are rejected", () => {
  assert.match(reportTransitionError("approve", "DRAFT"), /Cannot approve/);
  assert.match(reportTransitionError("issue", "IN_REVIEW"), /Cannot issue/);
  assert.match(reportTransitionError("bogus", "DRAFT"), /Unknown action/);
  assert.match(reportTransitionError("approve", "NOPE"), /Unknown status/);
});

test("a failed validation blocks approval and issue but not review", () => {
  assert.match(reportTransitionError("approve", "APPROVAL_READY", { validationFailed: true }), /Validation has failed/);
  assert.match(reportTransitionError("ready_for_approval", "IN_REVIEW", { validationFailed: true }), /Validation has failed/);
  assert.equal(reportTransitionError("start_review", "REVIEW_READY", { validationFailed: true }), null);
});

test("editable vs locked statuses", () => {
  assert.equal(isEditable("DRAFT"), true);
  assert.equal(isEditable("RETURNED"), true);
  assert.equal(isEditable("APPROVED"), false);
  assert.equal(isEditable("ISSUED"), false);
});

test("validateReportInput happy and sad paths", () => {
  assert.equal(validateReportInput({ templateKey: "WEEKLY_TRADE_PACK", title: "Trade Pack W30", reportingPeriod: "2026-W30" }), null);
  assert.match(validateReportInput({ title: "x", reportingPeriod: "p" }), /template/);
  assert.match(validateReportInput({ templateKey: "T", reportingPeriod: "p" }), /title/);
  assert.match(validateReportInput({ templateKey: "T", title: "x" }), /period/);
  assert.match(validateReportInput({ templateKey: "T", title: "x", reportingPeriod: "p", confidentiality: "NOPE" }), /confidentiality/);
});

test("reorderSections respects the requested order and renumbers", () => {
  const secs = [{ section_inst_id: 1 }, { section_inst_id: 2 }, { section_inst_id: 3 }];
  const out = reorderSections(secs, [3, 1]);
  assert.deepEqual(out.map((s) => s.section_inst_id), [3, 1, 2]);
  assert.deepEqual(out.map((s) => s.position), [1, 2, 3]);
});

test("mandatory sections cannot be excluded", () => {
  assert.equal(canExcludeSection({ mandatory: true }), false);
  assert.equal(canExcludeSection({ mandatory: false }), true);
});

test("version labels", () => {
  assert.equal(nextDraftLabel(1), "Draft v0.1");
  assert.equal(nextDraftLabel(0), "Draft v0.1");
  assert.equal(approvedLabel(0), "Approved v1.0");
  assert.equal(approvedLabel(2), "Approved v1.2");
});

test("formatReportMoney honours display units and en-GB negatives", () => {
  assert.equal(formatReportMoney(1234567, "GBP"), "£1,234,567");
  assert.equal(formatReportMoney(1234567, "GBP_000"), "£1,235k");
  assert.equal(formatReportMoney(1234567, "GBP_M"), "£1.2m");
  assert.equal(formatReportMoney(-5000, "GBP"), "(£5,000)");
  assert.equal(formatReportMoney(null), "—");
});

test("deriveDefaultTitle", () => {
  assert.equal(deriveDefaultTitle("Weekly Trade Pack", "2026-W30"), "Weekly Trade Pack — 2026-W30");
  assert.equal(deriveDefaultTitle("Weekly Trade Pack", null), "Weekly Trade Pack");
});

test("all ten perspectives exist and are recognised", () => {
  const keys = Object.keys(PERSPECTIVES);
  assert.equal(keys.length, 10);
  for (const k of keys) {
    assert.equal(isPerspective(k), true);
    assert.ok(PERSPECTIVES[k].focus.length > 0);
  }
  assert.equal(isPerspective("NOT_A_PERSPECTIVE"), false);
});

test("defaultIncludeFor scales with detail level", () => {
  assert.equal(defaultIncludeFor("HEADLINE").risks, false);
  assert.equal(defaultIncludeFor("STANDARD").risks, true);
  assert.equal(defaultIncludeFor("DETAILED").financial_effect, true);
});

test("buildReportContext produces the governed context shape (no raw data)", () => {
  const ctx = buildReportContext({
    reportId: 42, templateKey: "MANAGEMENT_ACCOUNTING_REPORT", reportingPeriod: "2026-06",
    dataThroughDate: "2026-06-30", audience: "SLT", sectionKey: "ebitda", sectionTitle: "EBITDA",
    scope: { entities: ["MUK"] }, comparator: "LATEST_FORECAST", perspective: "FINANCE_DIRECTOR",
    detailLevel: "STANDARD",
  });
  assert.equal(ctx.report_id, "42");
  assert.equal(ctx.template, "MANAGEMENT_ACCOUNTING_REPORT");
  assert.equal(ctx.commentary_type, "FINANCE_DIRECTOR");
  assert.deepEqual(ctx.scope.entities, ["MUK"]);
  assert.equal(ctx.comparison_basis, "LATEST_FORECAST");
  // an unknown perspective falls back safely
  const ctx2 = buildReportContext({ perspective: "BOGUS", detailLevel: "WRONG" });
  assert.equal(ctx2.commentary_type, "EXECUTIVE");
  assert.ok(DETAIL_LEVELS.includes(ctx2.detail_level));
});

test("renderContextPreamble is deterministic text", () => {
  const ctx = buildReportContext({ templateKey: "T", reportingPeriod: "2026-06", perspective: "RISK" });
  const out = renderContextPreamble(ctx, ["downside exposure"]);
  assert.match(out, /REPORT CONTEXT/);
  assert.match(out, /Perspective: Risk/);
  assert.match(out, /downside exposure/);
});
