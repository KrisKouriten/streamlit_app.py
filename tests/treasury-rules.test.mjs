import { test } from "node:test";
import assert from "node:assert/strict";
import {
  facilitySummary, termLoanSummary, hedgingSummary, salesIncomeSummary,
  cashReconVariance, cashReconStatus, cashReconSummary, SALES_STREAMS, isSalesStream,
} from "../lib/treasury-rules.js";

test("facilitySummary rolls drawings by driver, product, currency and month", () => {
  const rows = [
    { facility_payment_gbp: 100000, cost_driver: "Opex", product_type: "HSBC TradePay", payment_currency: "GBP", payment_month: "2026-12-01", status: "Disbursed" },
    { facility_payment_gbp: 50000, cost_driver: "Capex", product_type: "HSBC TradePay", payment_currency: "GBP", payment_month: "2026-12-01", status: "Disbursed" },
    { facility_payment_gbp: 200000, cost_driver: "Miniso LC's", product_type: "Post-shipment buyer loan", payment_currency: "USD", payment_month: "2027-01-01", status: "Disbursed" },
  ];
  const s = facilitySummary(rows);
  assert.equal(s.drawings, 3);
  assert.equal(s.totalGbp, 350000);
  assert.equal(s.byCostDriver[0].key, "Miniso LC's"); // biggest first
  assert.equal(s.byCostDriver[0].gbp, 200000);
  assert.equal(s.byProduct.find((p) => p.key === "HSBC TradePay").gbp, 150000);
  assert.equal(s.byCurrency.find((c) => c.key === "USD").gbp, 200000);
  assert.equal(s.byMonth.length, 2);
  assert.equal(s.byMonth[0].month, "2026-12"); // sorted ascending
  assert.equal(s.peakMonth.month, "2027-01");
});

test("termLoanSummary weights the interest rate by balance", () => {
  const s = termLoanSummary([
    { principal_gbp: 1000000, balance_gbp: 800000, interest_rate: 6 },
    { principal_gbp: 500000, balance_gbp: 200000, interest_rate: 8 },
  ]);
  assert.equal(s.count, 2);
  assert.equal(s.principal, 1500000);
  assert.equal(s.balance, 1000000);
  assert.equal(s.weightedRate, 6.4); // (800k*6 + 200k*8)/1000k
});

test("hedgingSummary nets MtM and groups open notional by pair", () => {
  const s = hedgingSummary([
    { pair: "GBPUSD", notional: 1000000, mtm_gbp: 12000, status: "OPEN" },
    { pair: "GBPUSD", notional: 500000, mtm_gbp: -3000, status: "OPEN" },
    { pair: "GBPEUR", notional: 300000, mtm_gbp: 1000, status: "SETTLED" },
  ]);
  assert.equal(s.openCount, 2);
  assert.equal(s.netMtmGbp, 10000);
  assert.equal(s.byPair[0].pair, "GBPUSD");
  assert.equal(s.byPair[0].notional, 1500000);
});

test("salesIncomeSummary totals per stream + invoiced vs received", () => {
  const s = salesIncomeSummary([
    { stream: "RETAIL", period: "2026-07", amount_gbp: 800000, received_gbp: 800000 },
    { stream: "WHOLESALE", period: "2026-07", amount_gbp: 200000, received_gbp: 150000 },
    { stream: "FRANCHISE", period: "2026-07", amount_gbp: 60000, received_gbp: 60000 },
    { stream: "RETAIL", period: "2026-08", amount_gbp: 900000, received_gbp: 0 },
  ]);
  assert.equal(s.streams.find((x) => x.code === "RETAIL").invoiced, 1700000);
  assert.equal(s.invoiced, 1960000);
  assert.equal(s.received, 1010000);
  assert.equal(s.outstanding, 950000);
  assert.equal(s.byMonth.length, 2);
  assert.equal(s.byMonth[0].total, 1060000); // 2026-07
});

test("cash reconciliation variance + status + summary", () => {
  assert.equal(cashReconVariance({ expected_cash: 10000, banked_cash: 9500 }), -500);
  assert.equal(cashReconStatus({ expected_cash: 10000, banked_cash: 9500 }).label, "Short");
  assert.equal(cashReconStatus({ expected_cash: 10000, banked_cash: 10000 }).label, "Reconciled");
  const s = cashReconSummary([
    { expected_cash: 10000, banked_cash: 9500, status: "OPEN" },
    { expected_cash: 8000, banked_cash: 8000, status: "RECONCILED" },
  ]);
  assert.equal(s.expected, 18000);
  assert.equal(s.banked, 17500);
  assert.equal(s.variance, -500);
  assert.equal(s.exceptions, 1);
});

test("sales stream vocab", () => {
  assert.equal(SALES_STREAMS.length, 3);
  assert.ok(isSalesStream("RETAIL"));
  assert.equal(isSalesStream("NOPE"), false);
});
