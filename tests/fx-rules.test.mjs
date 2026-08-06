import test from "node:test";
import assert from "node:assert/strict";
import { convertToGbp, amountToGbp, findRate, fxVariance, resolveApprovalFx, isForeignCurrency, validRate, FX_RATE_TYPE_KEYS } from "../lib/fx-rules.js";

test("validRate accepts only positive finite numbers", () => {
  assert.equal(validRate(1.27), 1.27);
  assert.equal(validRate("1.27"), 1.27);
  assert.equal(validRate(0), null);
  assert.equal(validRate(-1), null);
  assert.equal(validRate("x"), null);
  assert.equal(validRate(null), null);
});

test("isForeignCurrency: USD yes, GBP no", () => {
  assert.equal(isForeignCurrency("USD"), true);
  assert.equal(isForeignCurrency("usd"), true);
  assert.equal(isForeignCurrency("GBP"), false);
  assert.equal(isForeignCurrency(""), false);
  assert.equal(isForeignCurrency(null), false);
});

test("convertToGbp divides by the GBPUSD rate", () => {
  assert.equal(convertToGbp(1270, 1.27), 1000);
  assert.equal(convertToGbp(0, 1.27), 0);
  assert.equal(convertToGbp(100, 0), null);   // no usable rate
  assert.equal(convertToGbp("x", 1.27), null);
});

test("amountToGbp: GBP passes through, USD converts", () => {
  assert.equal(amountToGbp(1000, "GBP", null), 1000);
  assert.equal(amountToGbp(1270, "USD", 1.27), 1000);
  assert.equal(amountToGbp(1270, "USD", null), null);
});

test("findRate locates a currency×type rate", () => {
  const rates = [
    { currency: "USD", rate_type: "SPOT", rate: 1.27 },
    { currency: "USD", rate_type: "COSTING", rate: 1.30 },
  ];
  assert.equal(findRate(rates, "USD", "SPOT"), 1.27);
  assert.equal(findRate(rates, "usd", "costing"), 1.30);
  assert.equal(findRate(rates, "USD", "HEDGED"), null);
  assert.equal(findRate([], "USD", "SPOT"), null);
});

test("fxVariance = stock valuation − cash cost", () => {
  assert.equal(fxVariance(1000, 950), 50);      // stock valued above cash cost → favourable
  assert.equal(fxVariance(950, 1000), -50);
  assert.equal(fxVariance(null, 1000), null);
});

test("resolveApprovalFx: GBP order passes amount through with no FX", () => {
  const r = resolveApprovalFx({ currency: "GBP", amountCcy: 5000, rates: [] });
  assert.equal(r.foreign, false);
  assert.equal(r.cashflowGbp, 5000);
});

test("resolveApprovalFx: USD order converts at the two chosen rates", () => {
  const rates = [
    { currency: "USD", rate_type: "SPOT", rate: 1.27 },
    { currency: "USD", rate_type: "COSTING", rate: 1.25 },
  ];
  const r = resolveApprovalFx({ currency: "USD", amountCcy: 1270, costRateType: "SPOT", stockRateType: "COSTING", rates });
  assert.equal(r.foreign, true);
  assert.equal(r.costRate, 1.27);
  assert.equal(r.stockRate, 1.25);
  assert.equal(r.cashflowGbp, 1000);            // 1270 / 1.27
  assert.equal(Math.round(r.stockValueGbp), 1016);   // 1270 / 1.25 = 1016
  assert.equal(Math.round(r.fxVariance), 16);   // stock valued above cash cost
});

test("resolveApprovalFx: missing rate yields null GBP figures", () => {
  const r = resolveApprovalFx({ currency: "USD", amountCcy: 1270, costRateType: "HEDGED", stockRateType: "COSTING", rates: [] });
  assert.equal(r.cashflowGbp, null);
  assert.equal(r.stockValueGbp, null);
});

test("FX rate type keys are SPOT/HEDGED/COSTING", () => {
  assert.deepEqual(FX_RATE_TYPE_KEYS, ["SPOT", "HEDGED", "COSTING"]);
});
