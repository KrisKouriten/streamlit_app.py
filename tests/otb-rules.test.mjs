import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitByMix, mixError, reconcileTolerance, reconcileStore,
  plannedCostOfSales, targetStockFromWeeks, availableWarehouse, inTransitAvailable, clearanceReduction,
  resolveMinStock, computeRemainingOtb, validateAgainstOtb, landedCost,
  OTB_CHANNELS, TOLERANCE_STATUS, OTB_VALIDATION, OTB_COMPONENTS,
} from "../lib/otb-rules.js";

test("splitByMix + mixError", () => {
  assert.equal(splitByMix(500000, 78), 390000);
  assert.equal(splitByMix(500000, 22), 110000);
  assert.equal(mixError({ MINISO_MDS: 78, LOCAL_PURCHASE: 22 }), null);
  assert.match(mixError({ MINISO_MDS: 70, LOCAL_PURCHASE: 22 }), /100%/);
});

test("reconcileTolerance: within, warning, outside", () => {
  // 39.8m vs 40.0m = -0.5% → within ±1%
  const within = reconcileTolerance({ approved: 40_000_000, otbTotal: 39_800_000, tolerancePct: 1.0 });
  assert.equal(within.status, TOLERANCE_STATUS.WITHIN);
  assert.equal(within.diffPct, -0.5);
  // -1.5% → warning (≤ 2×)
  const warn = reconcileTolerance({ approved: 40_000_000, otbTotal: 39_400_000, tolerancePct: 1.0 });
  assert.equal(warn.status, TOLERANCE_STATUS.WARNING);
  // -5% → outside
  const out = reconcileTolerance({ approved: 40_000_000, otbTotal: 38_000_000, tolerancePct: 1.0 });
  assert.equal(out.status, TOLERANCE_STATUS.OUTSIDE);
});

test("reconcileTolerance: absolute and both", () => {
  const abs = reconcileTolerance({ approved: 1_000_000, otbTotal: 1_005_000, tolerancePct: 0.1, toleranceAbs: 10_000, type: "ABS" });
  assert.equal(abs.within, true); // £5k ≤ £10k even though 0.5% > 0.1%
  const both = reconcileTolerance({ approved: 1_000_000, otbTotal: 1_005_000, tolerancePct: 0.1, toleranceAbs: 10_000, type: "BOTH" });
  assert.equal(both.within, false); // pct fails
});

test("reconcileStore sums channels", () => {
  const r = reconcileStore({ approvedStoreSales: 500_000, channelAmounts: { MINISO_MDS: 390_000, LOCAL_PURCHASE: 110_000 } });
  assert.equal(r.otbTotal, 500_000);
  assert.equal(r.status, TOLERANCE_STATUS.WITHIN);
});

test("plannedCostOfSales from cos rate or gross margin", () => {
  assert.equal(plannedCostOfSales(1_000_000, { cosRate: 0.42 }), 420_000);
  assert.equal(plannedCostOfSales(1_000_000, { grossMarginRate: 0.58 }), 420_000);
  assert.equal(plannedCostOfSales(1_000_000, {}), null);
});

test("targetStockFromWeeks", () => {
  // £434,500 cos over a 4.345-week month = £100k/week; 6 weeks target = £600k
  assert.equal(targetStockFromWeeks(434_500, 6), 600_000);
  assert.equal(targetStockFromWeeks(100, null), null);
});

test("warehouse availability excludes reserved + damaged", () => {
  assert.equal(availableWarehouse({ stockValue: 2_000_000, reservedValue: 300_000, damagedValue: 100_000 }), 1_600_000);
  assert.equal(availableWarehouse({ stockValue: 100, reservedValue: 200 }), 0);
});

test("in-transit confidence + clearance realisation", () => {
  assert.equal(inTransitAvailable({ value: 500_000, confidence: 0.9 }), 450_000);
  assert.equal(inTransitAvailable({ value: 500_000, confidence: 2 }), 500_000); // clamped
  assert.equal(clearanceReduction({ stockValue: 600_000, realisationRate: 0.7 }), 420_000);
});

test("resolveMinStock picks the most specific rule", () => {
  const rules = [
    { level: "COMPANY", basis: "WEEKS_COVER", amount: 4, active: true },
    { level: "REGION", match_value: "London", basis: "WEEKS_COVER", amount: 5, active: true },
    { level: "STORE", match_value: "ST001", basis: "WEEKS_COVER", amount: 6, active: true },
    { level: "CATEGORY", match_value: "Beauty", basis: "WEEKS_COVER", amount: 8, active: true },
  ];
  const ctx = { storeCode: "ST001", region: "London", category: "Beauty" };
  assert.equal(resolveMinStock(rules, ctx).amount, 8); // category is most specific
  assert.equal(resolveMinStock(rules, { storeCode: "ST001", region: "London" }).amount, 6); // store
  assert.equal(resolveMinStock(rules, { region: "London" }).amount, 5); // region
  assert.equal(resolveMinStock(rules, {}).amount, 4); // company default
});

test("resolveMinStock respects channel + active", () => {
  const rules = [
    { level: "COMPANY", channel_code: "MINISO_MDS", basis: "VALUE", amount: 100, active: true },
    { level: "COMPANY", basis: "VALUE", amount: 50, active: true },
    { level: "STORE", match_value: "ST001", basis: "VALUE", amount: 999, active: false },
  ];
  assert.equal(resolveMinStock(rules, { channelCode: "MINISO_MDS" }).amount, 100);
  assert.equal(resolveMinStock(rules, { storeCode: "ST001", channelCode: "MINISO_MDS" }).amount, 100); // inactive store rule ignored
});

test("computeRemainingOtb returns signed components summing correctly", () => {
  const { components, remainingOtb } = computeRemainingOtb({
    plannedCos: 11_900_000, targetClosingStock: 5_400_000, newStoreStock: 1_100_000, fitoutInventory: 0, adjustments: 0,
    openingStoreStock: 4_100_000, openingWarehouseStock: 2_000_000, inTransit: 1_500_000,
    closureTransferable: 300_000, openCommitments: 3_000_000, approvedRequests: 800_000, clearanceReduction: 400_000,
  });
  // 11.9 + 5.4 + 1.1 − 4.1 − 2.0 − 1.5 − 0.3 − 3.0 − 0.8 − 0.4 = 6.3m
  assert.equal(remainingOtb, 6_300_000);
  assert.equal(components.length, OTB_COMPONENTS.length);
  const cos = components.find((c) => c.code === "PLANNED_COS");
  assert.equal(cos.sign, 1);
  assert.equal(components.find((c) => c.code === "OPEN_COMMITMENTS").sign, -1);
});

test("validateAgainstOtb: within, exceeds, none, exception", () => {
  assert.equal(validateAgainstOtb({ requestValue: 225_000, remainingBefore: 300_000 }).status, OTB_VALIDATION.WITHIN);
  const exceed = validateAgainstOtb({ requestValue: 400_000, remainingBefore: 300_000 });
  assert.equal(exceed.status, OTB_VALIDATION.EXCEEDS);
  assert.equal(exceed.remainingAfter, -100_000);
  assert.equal(validateAgainstOtb({ requestValue: 100, remainingBefore: 300_000, hasApprovedOtb: false }).status, OTB_VALIDATION.NONE);
  assert.equal(validateAgainstOtb({ requestValue: 400_000, remainingBefore: 300_000, exceptionApproved: true }).status, OTB_VALIDATION.EXCEPTION);
});

test("validateAgainstOtb warns near the limit", () => {
  const warn = validateAgainstOtb({ requestValue: 285_000, remainingBefore: 300_000, warnThresholdPct: 90 });
  assert.equal(warn.status, OTB_VALIDATION.WARNING);
});

test("landedCost applies freight, duty and FX", () => {
  assert.equal(landedCost({ purchaseValue: 100_000, freight: 5_000, duty: 2_000, fxRate: 1 }), 107_000);
  assert.equal(landedCost({ purchaseValue: 100_000, fxRate: 0.9 }), 90_000);
});

test("OTB_CHANNELS covers the two purchase channels", () => {
  assert.deepEqual(OTB_CHANNELS, ["MINISO_MDS", "LOCAL_PURCHASE"]);
});
