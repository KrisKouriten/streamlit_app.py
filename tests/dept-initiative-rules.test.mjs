import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONTH_KEYS, defaultKindFor, phaseCost, costAnnual, generateLines,
  initiativeInvestment, commercialSummary, validateInitiative,
} from "../lib/dept-initiative-rules.js";

const sumP = (arr) => arr.reduce((a, b) => a + Math.round(b * 100), 0);

test("defaultKindFor maps departments to their operational unit", () => {
  assert.equal(defaultKindFor("Marketing"), "CAMPAIGN");
  assert.equal(defaultKindFor("Architecture & Build"), "PROJECT");
  assert.equal(defaultKindFor("Logistics"), "CONTRACT");
  assert.equal(defaultKindFor("Nowhere"), "INITIATIVE");
});

test("phaseCost EVEN spreads across the active month range, penny-exact", () => {
  const p = phaseCost({ amount: 1000, phasing: "EVEN" }, { startMonth: 1, endMonth: 4 });
  assert.equal(sumP(p), 100000);
  assert.equal(p[4], 0); // May onwards empty
  assert.ok(p[0] > 0 && p[3] > 0);
});

test("phaseCost ONEOFF puts the whole amount in one month", () => {
  const p = phaseCost({ amount: 5000, phasing: "ONEOFF", one_off_month: 10 });
  assert.equal(p[9], 5000);
  assert.equal(sumP(p), 500000);
});

test("phaseCost QUARTERLY hits quarter-ends within range", () => {
  const p = phaseCost({ amount: 4000, phasing: "QUARTERLY" }, { startMonth: 1, endMonth: 12 });
  assert.equal(sumP(p), 400000);
  assert.deepEqual([p[2], p[5], p[8], p[11]], [1000, 1000, 1000, 1000]); // Mar/Jun/Sep/Dec
});

test("phaseCost MANUAL uses the entered months", () => {
  const cost = { phasing: "MANUAL", ...Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])), m02: 250, m07: 750 };
  const p = phaseCost(cost, { startMonth: 1, endMonth: 12 });
  assert.equal(p[1], 250); assert.equal(p[6], 750); assert.equal(sumP(p), 100000);
});

test("generateLines aggregates cost items across initiatives by category+label", () => {
  const inits = [
    { classification: "GROWTH", start_month: 1, end_month: 12, costs: [{ category: "Media", line_label: "Paid media", amount: 1200, phasing: "EVEN" }] },
    { classification: "GROWTH", start_month: 1, end_month: 12, costs: [{ category: "Media", line_label: "Paid media", amount: 1200, phasing: "EVEN" }] },
  ];
  const lines = generateLines(inits);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].source, "INITIATIVE");
  assert.equal(lines[0].classification, "GROWTH");
  assert.equal(sumP(MONTH_KEYS.map((k) => lines[0][k])), 240000); // 2 × £1,200
});

test("generateLines marks classification MIXED when initiatives disagree", () => {
  const lines = generateLines([
    { classification: "GROWTH", start_month: 1, end_month: 12, costs: [{ category: "A", line_label: "x", amount: 100, phasing: "EVEN" }] },
    { classification: "COMMITTED", start_month: 1, end_month: 12, costs: [{ category: "A", line_label: "x", amount: 100, phasing: "EVEN" }] },
  ]);
  assert.equal(lines[0].classification, "MIXED");
});

test("commercialSummary: investment, incremental sales/margin, contribution", () => {
  const inits = [{
    classification: "GROWTH", start_month: 10, end_month: 12, incremental_sales: 350000, incremental_margin: 210000,
    costs: [{ amount: 40000, phasing: "EVEN" }, { amount: 43000, phasing: "EVEN" }],
  }];
  const s = commercialSummary(inits);
  assert.equal(s.investment, 83000);
  assert.equal(s.incrementalSales, 350000);
  assert.equal(s.incrementalMargin, 210000);
  assert.equal(s.contribution, 127000); // 210,000 − 83,000
  assert.equal(initiativeInvestment(inits[0]), 83000);
});

test("validateInitiative catches missing name and bad ranges", () => {
  assert.equal(validateInitiative({ name: "Xmas", start_month: 10, end_month: 12 }), null);
  assert.match(validateInitiative({ name: "" }), /name/);
  assert.match(validateInitiative({ name: "x", start_month: 6, end_month: 3 }), /before start/);
});
