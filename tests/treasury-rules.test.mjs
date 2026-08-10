import { test } from "node:test";
import assert from "node:assert/strict";
import {
  facilitySummary, termLoanSummary, hedgingSummary, salesIncomeSummary,
  cashReconVariance, cashReconStatus, cashReconSummary, SALES_STREAMS, isSalesStream,
  reconcileDcFacility, facilityRefIndex, lcOnFacility, isRealLcRef, normRef,
  parseFacilityCsv, FACILITY_UPLOAD_COLUMNS,
} from "../lib/treasury-rules.js";

test("parseFacilityCsv maps headers, coerces types, parses UK + ISO dates", () => {
  const csv = [
    "Reference,Beneficiary,Customer Reference,Currency,Loan Amount,Outstanding,Due Date,Start Date,Product,Cost Driver,Settlement Month,Facility GBP,Days",
    "LAIUK1080844,Miniso,LC91A,USD,\"154,000.00\",154000,31/01/2027,2026-07-15,Post-shipment buyer loan,Miniso LC's,2027-01,\"£114,000\",180",
  ].join("\n");
  const { rows, errors } = parseFacilityCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.reference, "LAIUK1080844");
  assert.equal(r.customer_reference, "LC91A");
  assert.equal(r.payment_currency, "USD");
  assert.equal(r.loan_amount, 154000);
  assert.equal(r.due_date, "2027-01-31");       // DD/MM/YYYY → ISO
  assert.equal(r.loan_start_date, "2026-07-15"); // ISO passthrough
  assert.equal(r.payment_month, "2027-01-01");   // YYYY-MM → first of month
  assert.equal(r.facility_payment_gbp, 114000);  // £ + comma stripped
  assert.equal(r.loan_period_days, 180);
});

test("parseFacilityCsv requires a reference column and flags duplicates", () => {
  assert.ok(parseFacilityCsv("Beneficiary,Amount\nMiniso,100").errors[0].includes("reference"));
  const dup = parseFacilityCsv("reference,loan_amount\nLAIUK1,100\nLAIUK1,200");
  assert.equal(dup.rows.length, 1);
  assert.ok(dup.errors.some((e) => e.includes("duplicate")));
  assert.ok(FACILITY_UPLOAD_COLUMNS.includes("reference"));
});

test("reconcileDcFacility matches LC refs to facility drawings, per DC", () => {
  const dcs = [
    { dc_id: 1, purchase_id: 10, dc_reference: "DC UK1233788", dc_value: 200000, currency: "USD", purchase_ref: "LC91" },
    { dc_id: 2, purchase_id: 10, dc_reference: "DC UK1233789", dc_value: 154000, currency: "USD", purchase_ref: "LC91" },
  ];
  const lcs = [
    { purchase_id: 10, dc_reference: "DC UK1233788", lc_reference: "LAIUK1080844", lc_amount: 154000, lc_settled: false },
    { purchase_id: 10, dc_reference: "DC UK1233788", lc_reference: "TBC",          lc_amount: 20000,  lc_settled: false }, // placeholder → not on facility
    { purchase_id: 10, dc_reference: "DC UK1233789", lc_reference: "LAIUK1082310", lc_amount: 154000, lc_settled: false },
  ];
  const facility = [
    { reference: "LAIUK1080844", customer_reference: "LC91A", loan_amount: 154000, outstanding_amount: 154000, due_date: "2027-01-31", status: "Disbursed" },
    // LAIUK1082310 NOT in the facility extract yet → gap
  ];
  const { rows, totals } = reconcileDcFacility(dcs, lcs, facility);
  const a = rows.find((g) => g.dc_id === 1);
  assert.equal(a.lcLogged, 174000);          // 154000 + 20000 logged
  assert.equal(a.facilityDrawn, 154000);     // only the matched LC is drawn
  assert.equal(a.remaining, 26000);          // 200000 − 174000 (vs logged)
  assert.equal(a.gap, 20000);                // logged not yet on facility (the TBC)
  assert.equal(a.onFacilityCount, 1);
  assert.deepEqual(a.notOnFacility, ["TBC"]); // placeholder LC flagged as not-yet
  const b = rows.find((g) => g.dc_id === 2);
  assert.equal(b.facilityDrawn, 0);          // LAIUK1082310 not on facility yet
  assert.equal(b.notOnFacilityCount, 1);
  assert.equal(totals.totalValue, 354000);
  assert.equal(totals.totalDrawn, 154000);
  assert.equal(totals.notOnFacilityCount, 2);
});

test("lcOnFacility / isRealLcRef handle placeholders and either match key", () => {
  const idx = facilityRefIndex([{ reference: "LAIUK1", customer_reference: "CUST-9", loan_amount: 100 }]);
  assert.ok(lcOnFacility({ lc_reference: "laiuk1" }, idx));      // case-insensitive on reference
  assert.ok(lcOnFacility({ lc_reference: "cust-9" }, idx));      // matches customer_reference too
  assert.equal(lcOnFacility({ lc_reference: "NOPE" }, idx), null);
  assert.equal(lcOnFacility({ lc_reference: "TBC" }, idx), null); // placeholder → null
  assert.equal(isRealLcRef("TBC"), false);
  assert.equal(isRealLcRef("LAIUK1080844"), true);
  assert.equal(normRef("  laiuk 1080844 "), "LAIUK 1080844");
});

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
