import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scenarioLine, pctOfSales, companyMarginImpact, blendedMargin, scenarioImpact, promotionRoi,
  SCENARIO_TYPES, isScenarioType,
} from "../lib/pricing-scenario-rules.js";

test("scenarioLine computes current vs proposed margin + reduction", () => {
  // cost 15, VAT 20%. Current RRP 30 (exVat 25, GP 10, 40%). New RRP 24 (exVat 20, GP 5, 25%).
  const l = scenarioLine({ currentRrp: 30, newRrp: 24, vat: 0.2, totalCost: 15 });
  assert.equal(l.current.gpPct, 0.4);
  assert.equal(l.proposed.gpPct, 0.25);
  assert.equal(l.marginReductionPts, 0.15);
});

test("pctOfSales returns company / category / promotion shares", () => {
  const p = pctOfSales({ skuSales: 350000, companySales: 10000000, categorySales: 2000000, promotionSales: 1000000 });
  assert.equal(p.companyPct, 0.035); // 3.5% of company
  assert.equal(p.categoryPct, 0.175);
  assert.equal(p.promotionPct, 0.35);
});

test("companyMarginImpact weights the movement by company share", () => {
  // 3.5% company share, 61% → 54% → −0.245% company margin impact.
  const impact = companyMarginImpact({ companyPct: 0.035, currentGpPct: 0.61, newGpPct: 0.54 });
  assert.equal(impact, -0.0024); // 0.035 × (0.54 − 0.61) = −0.00245 → −0.0024 (≈ −0.24pts to company margin)
});

test("blendedMargin weights by SALES VALUE, not a simple average", () => {
  const lines = [
    { salesValue: 900000, currentGpPct: 0.60, newGpPct: 0.60 },  // big, unchanged
    { salesValue: 100000, currentGpPct: 0.60, newGpPct: 0.40, scenarioSalesValue: 150000 }, // small, discounted, volume up
  ];
  const b = blendedMargin(lines);
  assert.equal(b.current, 0.6); // both at 60%
  // Scenario: (900k×0.6 + 150k×0.4) / (900k+150k) = (540000 + 60000)/1050000 = 0.5714
  assert.equal(b.scenario, 0.5714);
  assert.ok(b.movement < 0);
  // A simple average would wrongly give (0.6+0.4)/2 = 0.5 — prove we're not doing that.
  assert.notEqual(b.scenario, 0.5);
});

test("scenarioImpact returns revenue / GP / cash movement", () => {
  const s = scenarioImpact({ currentRrp: 30, newRrp: 24, vat: 0.2, totalCost: 15, baselineUnits: 100, expectedUnits: 160 });
  assert.equal(s.unitsMovement, 60);
  // base GP 100×10=1000; scenario GP 160×5=800 → −200
  assert.equal(s.grossProfitMovement, -200);
  assert.equal(s.cashRecovery, 3200); // 160 × 20
});

test("promotionRoi > 1 when volume pays for the discount", () => {
  assert.equal(promotionRoi({ incrementalGrossProfit: 1500, marginGivenAway: 1000 }), 1.5);
  assert.equal(promotionRoi({ incrementalGrossProfit: 500, marginGivenAway: 0 }), null);
});

test("scenario type vocab", () => {
  assert.ok(isScenarioType("PROMOTION"));
  assert.ok(!isScenarioType("NOPE"));
  assert.equal(SCENARIO_TYPES.length, 6);
});
