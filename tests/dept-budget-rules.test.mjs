import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_KEYS, lineTotal, monthlyTotals, grandTotal, priorYearTotal,
  categoryGroups, variance, equalSplit, validateLine, validateBudget,
  budgetTransitionError, isEditableBudget,
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

test("state machine: only legal transitions pass; DRAFT is the only editable state", () => {
  assert.equal(budgetTransitionError("submit", "DRAFT"), null);
  assert.equal(budgetTransitionError("approve", "SUBMITTED"), null);
  assert.equal(budgetTransitionError("reopen", "APPROVED"), null);
  assert.match(budgetTransitionError("approve", "DRAFT"), /Cannot approve/);
  assert.match(budgetTransitionError("submit", "APPROVED"), /Cannot submit/);
  assert.match(budgetTransitionError("frobnicate", "DRAFT"), /Unknown action/);
  assert.equal(isEditableBudget("DRAFT"), true);
  assert.equal(isEditableBudget("SUBMITTED"), false);
  assert.equal(isEditableBudget("APPROVED"), false);
});
