import { test } from "node:test";
import assert from "node:assert/strict";
import { lcStage, lcStageLabel, facilityLifecycleSummary, LC_STAGES } from "../lib/treasury-rules.js";

test("lcStage infers the DC→LC→loan stage from milestones", () => {
  assert.equal(lcStage({}), "PENDING");
  assert.equal(lcStage({ dc_reference: "DC123" }), "DC_LOGGED");
  assert.equal(lcStage({ lc_reference: "LC90A" }), "DC_LOGGED");
  assert.equal(lcStage({ lc_reference: "LC90A", lc_confirmed_date: "2026-06-01" }), "LC_CONFIRMED");
  assert.equal(lcStage({ lc_confirmed_date: "2026-06-01", goods_arrived_date: "2026-07-01" }), "TRADE_LOAN");
  assert.equal(lcStage({ lc_confirmed_date: "2026-06-01", loan_type: "TRADE" }), "TRADE_LOAN");
  assert.equal(lcStage({ goods_arrived_date: "2026-07-01", actual_payment_date: "2026-07-10" }), "DRAWN");
  assert.equal(lcStage({ actual_payment_date: "2026-07-10", lc_settled: true }), "SETTLED"); // settled wins
});

test("lcStageLabel maps codes", () => {
  assert.equal(lcStageLabel("LC_CONFIRMED"), "LC confirmed · import");
  assert.equal(lcStageLabel("SETTLED"), "Settled");
  assert.equal(LC_STAGES.length, 6);
});

test("facilityLifecycleSummary counts stages + open amount by currency", () => {
  const s = facilityLifecycleSummary([
    { currency: "USD", lc_amount: 100000, lc_reference: "LC90", lc_confirmed_date: "2026-06-01" }, // LC_CONFIRMED, open
    { currency: "USD", lc_amount: 50000, actual_payment_date: "2026-07-10" },                       // DRAWN, open
    { currency: "GBP", lc_amount: 20000, dc_reference: "DC1" },                                      // DC_LOGGED, open
    { currency: "USD", lc_amount: 80000, lc_settled: true },                                         // SETTLED
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.openCount, 3);
  assert.equal(s.settledCount, 1);
  assert.equal(s.byStage.LC_CONFIRMED, 1);
  assert.equal(s.byStage.DRAWN, 1);
  assert.equal(s.byStage.DC_LOGGED, 1);
  assert.equal(s.byStage.SETTLED, 1);
  assert.equal(s.openByCcy.USD, 150000); // 100k + 50k open; settled 80k excluded
  assert.equal(s.openByCcy.GBP, 20000);
});
