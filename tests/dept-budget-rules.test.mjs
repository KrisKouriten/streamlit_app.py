import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_KEYS, lineTotal, monthlyTotals, grandTotal, priorYearTotal,
  categoryGroups, variance, equalSplit, validateLine, validateBudget,
  budgetTransitionError, isEditableBudget, availableTransitions,
  budgetSummary, completionPct, quarterTotals, lineMovers, budgetValidation,
} from "../lib/dept-budget-rules.js";

const lineWith = (over = {}) => ({ category: "Media", line_label: "Paid media", prior_year: 0, ...Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])), ...over });

test("lineTotal sums the 12 months", () => {
  const l = lineWith({ m01: 100, m02: 100, m12: 50 });
  assert.equal(lineTotal(l), 250);
});

test("monthlyTotals and grandTotal aggregate across lines", () => {
  const lines = [lineWith({ m01: 100, m02: 200 }), lineWith({ m01: 50, m02: 25 })];
  const monthly = monthlyTotals(lines);
  assert.equal(monthly[0], 150);
  assert.equal(monthly[1], 225);
  assert.equal(monthly[2], 0);
  assert.equal(grandTotal(lines), 375);
});

test("priorYearTotal sums prior-year figures", () => {
  const lines = [lineWith({ prior_year: 1000 }), lineWith({ prior_year: 250 })];
  assert.equal(priorYearTotal(lines), 1250);
});

test("categoryGroups preserves first-seen order with subtotals", () => {
  const lines = [
    lineWith({ category: "Media", m01: 100 }),
    lineWith({ category: "Brand", m01: 40 }),
    lineWith({ category: "Media", m02: 60 }),
  ];
  const groups = categoryGroups(lines);
  assert.deepEqual(groups.map((g) => g.category), ["Media", "Brand"]);
  assert.equal(groups[0].subtotal, 160);
  assert.equal(groups[0].monthly[0], 100);
  assert.equal(groups[0].monthly[1], 60);
  assert.equal(groups[1].subtotal, 40);
});

test("variance: absolute and percentage, null pct from a zero base", () => {
  assert.deepEqual(variance(120, 100), { abs: 20, pct: 20 });
  assert.deepEqual(variance(80, 100), { abs: -20, pct: -20 });
  assert.deepEqual(variance(50, 0), { abs: 50, pct: null });
});

test("equalSplit spreads to exactly the annual, pennies to earliest months", () => {
  // Sum in pennies so the assertion isn't at the mercy of float addition.
  const sumP = (arr) => arr.reduce((a, b) => a + Math.round(b * 100), 0);
  const s = equalSplit(1000);
  assert.equal(sumP(s), 100000);
  // 1000/12 = 83.33 with a 0.04 remainder → first 4 months carry the extra penny
  assert.equal(s[0], 83.34);
  assert.equal(s[4], 83.33);

  const even = equalSplit(1200);
  assert.deepEqual(new Set(even), new Set([100]));
  assert.equal(sumP(even), 120000);

  const neg = equalSplit(-100);
  assert.equal(sumP(neg), -10000);
});

test("validateLine needs a label; validateBudget needs dept + sane year", () => {
  assert.equal(validateLine({ line_label: "Agency" }), null);
  assert.match(validateLine({ line_label: "  " }), /needs a name/);
  assert.equal(validateBudget({ department: "Marketing", budget_year: 2026 }), null);
  assert.match(validateBudget({ department: "", budget_year: 2026 }), /department/);
  assert.match(validateBudget({ department: "Marketing", budget_year: 1900 }), /valid budget year/);
});

test("state machine: the full chain's legal transitions pass; DRAFT is the only editable state", () => {
  assert.equal(budgetTransitionError("submit_to_finance", "DRAFT"), null);
  assert.equal(budgetTransitionError("finance_pass", "FINANCE_REVIEW"), null);
  assert.equal(budgetTransitionError("dept_approve", "DEPT_APPROVAL"), null);
  assert.equal(budgetTransitionError("slt_approve", "SLT_APPROVAL"), null);
  assert.equal(budgetTransitionError("reopen", "LOCKED"), null);
  assert.equal(budgetTransitionError("finance_return", "FINANCE_REVIEW"), null);
  assert.match(budgetTransitionError("slt_approve", "DRAFT"), /Cannot slt approve/);
  assert.match(budgetTransitionError("submit_to_finance", "LOCKED"), /Cannot submit/);
  assert.match(budgetTransitionError("frobnicate", "DRAFT"), /Unknown action/);
  assert.equal(isEditableBudget("DRAFT"), true);
  assert.equal(isEditableBudget("FINANCE_REVIEW"), false);
  assert.equal(isEditableBudget("LOCKED"), false);
});

test("availableTransitions lists exactly what's runnable from a stage", () => {
  const draft = availableTransitions("DRAFT").map((t) => t.action);
  assert.deepEqual(draft, ["submit_to_finance"]);
  const fin = availableTransitions("FINANCE_REVIEW").map((t) => t.action).sort();
  assert.deepEqual(fin, ["finance_pass", "finance_return"]);
  assert.deepEqual(availableTransitions("SLT_APPROVAL").map((t) => t.action).sort(), ["slt_approve", "slt_return"]);
});

const L = (over) => ({ category: "Media", line_label: "Paid media", prior_year: 0, commentary: "", ...Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])), ...over });

test("budgetSummary: envelope, remaining, vs prior year, completion", () => {
  const lines = [L({ line_label: "A", m01: 600, prior_year: 500 }), L({ line_label: "B", prior_year: 0 })];
  const s = budgetSummary(1000, lines);
  assert.equal(s.target, 1000);
  assert.equal(s.proposed, 600);
  assert.equal(s.remaining, 400);
  assert.equal(s.priorYear, 500);
  assert.equal(s.vsPriorAbs, 100);
  assert.equal(s.completion, 50); // 1 of 2 named lines has a value
  assert.equal(budgetSummary(null, lines).remaining, null);
});

test("quarterTotals buckets the 12 months into quarters", () => {
  const q = quarterTotals(L({ m01: 10, m02: 5, m04: 20, m12: 3 }));
  assert.deepEqual(q, [15, 20, 0, 3]);
});

test("lineMovers ranks increases and reductions vs prior year", () => {
  const lines = [L({ line_label: "Up big", m01: 300, prior_year: 100 }), L({ line_label: "Down", m01: 50, prior_year: 200 })];
  const m = lineMovers(lines);
  assert.equal(m.up[0].label, "Up big");
  assert.equal(m.up[0].delta, 200);
  assert.equal(m.down[0].label, "Down");
  assert.equal(m.down[0].delta, -150);
});

test("budgetValidation flags over-target and missing commentary on material lines", () => {
  const lines = [
    L({ line_label: "Big no note", m01: 20000, prior_year: 0 }),           // material by £, no commentary
    L({ line_label: "Big with note", m02: 20000, commentary: "explained" }), // material but has commentary
    L({ line_label: "Small", m03: 100, prior_year: 100 }),                  // immaterial
  ];
  const issues = budgetValidation(30000, lines);
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes("over_target")); // 40,100 > 30,000
  assert.ok(codes.includes("missing_commentary"));
  assert.equal(issues.filter((i) => i.code === "missing_commentary").length, 1);
});
