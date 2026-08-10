import { test } from "node:test";
import assert from "node:assert/strict";
import { isForeignRow, stockValue, fxToPL, inventoryCostFx, reportBasis, reportedGbp } from "../lib/procurement-close-rules.js";
import {
  financeActionError, displayStatus, committedAmount, lineValue, challengeReasonLabels,
  paymentStatusOf, isProcChallengeReason, procRef, isMerchRequest, PROC_FINANCE_STATUSES,
  settlesByLc, lcActionError, lcStatus, dcDrawdown, validateDc, normDcRef,
} from "../lib/procurement-close-rules.js";
const ruleLc = { settlesByLc, lcActionError, lcStatus };

test("dcDrawdown — used = logged LCs, remaining = value − used, grouped by DC ref", () => {
  const dcs = [
    { dc_id: 1, dc_reference: "DC UK1233788", dc_value: 200000 },
    { dc_id: 2, dc_reference: "DC UK1233789", dc_value: 154000 },
  ];
  const lcs = [
    { lc_id: 10, dc_reference: "DC UK1233788", lc_amount: 174900, lc_settled: false },
    { lc_id: 11, dc_reference: "dc uk1233788", lc_amount: 20000, lc_settled: true, lc_settled_amount: 19500 }, // case-insensitive match
    { lc_id: 12, dc_reference: "DC UK1233789", lc_amount: 154000, lc_settled: false },
    { lc_id: 13, dc_reference: "DC UK9999999", lc_amount: 5000, lc_settled: false }, // no DC record → ungrouped
    { lc_id: 14, dc_reference: "", lc_amount: 1000, lc_settled: false },             // blank → ungrouped
  ];
  const out = dcDrawdown(dcs, lcs);
  const a = out.find((g) => g.dc_id === 1);
  assert.equal(a.count, 2);
  assert.equal(a.used, 194900);            // 174900 + 20000 (both logged)
  assert.equal(a.settled, 19500);          // settled amount preferred
  assert.equal(a.remaining, 5100);         // 200000 − 194900
  assert.equal(Math.round(a.utilisation * 1000) / 1000, 0.975);
  assert.equal(a.over, false);
  const b = out.find((g) => g.dc_id === 2);
  assert.equal(b.used, 154000);
  assert.equal(b.remaining, 0);
  const ung = out.find((g) => g.ungrouped);
  assert.equal(ung.count, 2);              // DC9999999 + blank
  assert.equal(ung.used, 6000);
  assert.equal(ung.dc_value, null);
  assert.equal(ung.remaining, null);
});

test("dcDrawdown — over-draw flagged when logged LCs exceed the DC value", () => {
  const out = dcDrawdown([{ dc_id: 1, dc_reference: "DC1", dc_value: 100000 }],
    [{ lc_id: 1, dc_reference: "DC1", lc_amount: 120000 }]);
  assert.equal(out[0].used, 120000);
  assert.equal(out[0].remaining, -20000);
  assert.equal(out[0].over, true);
});

test("validateDc — reference required, value optional and non-negative", () => {
  assert.deepEqual(validateDc({ dc_reference: "  DC  UK1233788 ", dc_value: "200000" }).clean,
    { dc_reference: "DC UK1233788", dc_value: 200000, notes: null });
  assert.ok(validateDc({ dc_reference: "" }).errors.includes("DC reference is required"));
  assert.ok(validateDc({ dc_reference: "DC1", dc_value: "-5" }).errors.length === 1);
  assert.equal(validateDc({ dc_reference: "DC1" }).clean.dc_value, null); // blank value ok
  assert.equal(normDcRef(" DC  UK1233788 "), "dc uk1233788");
});

test("finance lifecycle gate — approve", () => {
  assert.equal(financeActionError("approve", { finance_status: "PENDING" }), null);
  assert.ok(financeActionError("approve", { finance_status: "APPROVED" }));
});

test("finance lifecycle gate — challenge available while open; close needs approval", () => {
  assert.equal(financeActionError("challenge", { finance_status: "PENDING" }), null); // challenge available from pending
  assert.ok(financeActionError("close", { finance_status: "PENDING" }));
  assert.equal(financeActionError("challenge", { finance_status: "APPROVED" }), null);
  assert.equal(financeActionError("close", { finance_status: "APPROVED" }), null);
  assert.equal(financeActionError("close", { finance_status: "CHALLENGED" }), null);
  assert.ok(financeActionError("close", { finance_status: "CLOSED" }));
  assert.ok(financeActionError("challenge", { finance_status: "CLOSED" }));
});

test("LC settlement — Miniso settles by LC, Local does not", () => {
  const { settlesByLc, lcActionError, lcStatus } = ruleLc;
  assert.equal(settlesByLc({ source: "MINISO" }), true);
  assert.equal(settlesByLc({ source: "LOCAL" }), false);
  // Local purchases are not LC-settled.
  assert.ok(lcActionError("log-lc", { source: "LOCAL", finance_status: "APPROVED" }));
  // A Miniso LC can be logged once approved, then reconciled once logged.
  assert.ok(lcActionError("log-lc", { source: "MINISO", finance_status: "PENDING" })); // approve first
  assert.equal(lcActionError("log-lc", { source: "MINISO", finance_status: "APPROVED" }), null);
  assert.ok(lcActionError("reconcile-lc", { source: "MINISO", finance_status: "APPROVED" })); // no LC yet
  assert.equal(lcActionError("reconcile-lc", { source: "MINISO", finance_status: "APPROVED", lc_reference: "LC-1" }), null);
  assert.ok(lcActionError("reconcile-lc", { source: "MINISO", finance_status: "APPROVED", lc_reference: "LC-1", lc_settled: true })); // already settled
  assert.equal(lcStatus({ source: "LOCAL" }), null);
  assert.equal(lcStatus({ source: "MINISO" }).label, "LC pending");
  assert.equal(lcStatus({ source: "MINISO", lc_reference: "LC-1" }).label, "LC confirmed");
  assert.equal(lcStatus({ source: "MINISO", lc_reference: "LC-1", lc_settled: true }).label, "LC settled");
});

test("finance lifecycle gate — reopen only from challenged/closed", () => {
  assert.equal(financeActionError("reopen", { finance_status: "CLOSED" }), null);
  assert.equal(financeActionError("reopen", { finance_status: "CHALLENGED" }), null);
  assert.ok(financeActionError("reopen", { finance_status: "APPROVED" }));
  assert.ok(financeActionError("reopen", { finance_status: "PENDING" }));
});

test("displayStatus maps each finance status to a tone", () => {
  assert.deepEqual(displayStatus({ finance_status: "PENDING" }), { label: "Pending", tone: "amber" });
  assert.deepEqual(displayStatus({ finance_status: "APPROVED" }), { label: "Approved", tone: "accent" });
  assert.deepEqual(displayStatus({ finance_status: "CHALLENGED" }), { label: "Challenged", tone: "red" });
  assert.deepEqual(displayStatus({ finance_status: "CLOSED" }), { label: "Closed", tone: "green" });
  // Missing status defaults to Pending.
  assert.equal(displayStatus({}).label, "Pending");
});

test("lineValue prefers landed cost, falls back to order amount", () => {
  assert.equal(lineValue({ landed_cost: 12000, amount_gbp: 9000 }), 12000);
  assert.equal(lineValue({ amount_gbp: 9000 }), 9000);
  assert.equal(lineValue({ landed_cost: 0, amount_gbp: 9000 }), 9000);
});

test("committedAmount prefers the invoice net", () => {
  assert.equal(committedAmount({ invoice_amount: 8800, landed_cost: 12000 }), 8800);
  assert.equal(committedAmount({ landed_cost: 12000 }), 12000);
});

test("challengeReasonLabels maps codes back to labels", () => {
  assert.deepEqual(challengeReasonLabels("INVOICE_VALUE,LANDED_COST"), ["Invoice value", "Landed cost"]);
  assert.deepEqual(challengeReasonLabels(""), []);
  assert.ok(isProcChallengeReason("OTB_EXCEEDED"));
  assert.equal(isProcChallengeReason("NOPE"), false);
});

test("paymentStatusOf + procRef + isMerchRequest", () => {
  assert.equal(paymentStatusOf({ payment_status: "PAID" }).tone, "green");
  assert.equal(paymentStatusOf({}).code, "UNPAID"); // defaults to Unpaid
  assert.equal(paymentStatusOf({}).label, "Unpaid");
  assert.equal(procRef({ reference: "PO-9" }), "PO-9");
  assert.equal(procRef({ purchase_id: 5, channel_code: "MINISO_MDS" }), "MR-5");
  assert.equal(procRef({ purchase_id: 5 }), "PP-5");
  assert.equal(isMerchRequest({ channel_code: "LOCAL_PURCHASE" }), true);
  assert.equal(isMerchRequest({}), false);
});

test("vocab", () => {
  assert.deepEqual(PROC_FINANCE_STATUSES, ["PENDING", "APPROVED", "CHALLENGED", "CLOSED"]);
});

test("FX helpers: foreign flag, stock value, FX to P&L", () => {
  assert.equal(isForeignRow({ currency: "USD" }), true);
  assert.equal(isForeignRow({ currency: "GBP" }), false);
  assert.equal(isForeignRow({}), false);                    // defaults to GBP
  assert.equal(stockValue({ stock_value_gbp: 10160 }), 10160);
  assert.equal(stockValue({}), null);
  // costing valuation £10,160 vs cash cost £10,000 → +£160 to P&L
  assert.equal(fxToPL({ stock_value_gbp: 10160, amount_gbp: 10000 }), 160);
  assert.equal(fxToPL({ amount_gbp: 10000 }), null);        // not yet valued
  assert.equal(fxToPL({ stock_value_gbp: 9500, amount_gbp: 10000 }), -500);
});

test("reportBasis defaults to SPOT and normalises", () => {
  assert.equal(reportBasis({}), "SPOT");
  assert.equal(reportBasis({ report_rate_type: "hedged" }), "HEDGED");
  assert.equal(reportBasis({ report_rate_type: "bogus" }), "SPOT");
});

test("reportedGbp converts at the reporting-basis rate", () => {
  // $12,700 at a 1.27 spot rate → £10,000; at a 1.30 hedged rate → £9,769.23
  const row = { currency: "USD", amount_ccy: 12700, amount_gbp: 9800 };
  assert.equal(reportedGbp(row, 1.27), 10000);
  assert.equal(Math.round(reportedGbp(row, 1.30) * 100) / 100, 9769.23);
  assert.equal(reportedGbp({ currency: "GBP", amount_gbp: 5000 }, 1.27), 5000); // GBP passthrough
  assert.equal(reportedGbp(row, null), 9800); // no rate → fall back to booked GBP
});

test("inventoryCostFx: £ inventory value at the costing FX rate", () => {
  // foreign: $12,700 at a 1.27 USD/£ costing rate → £10,000
  assert.equal(inventoryCostFx({ currency: "USD", amount_ccy: 12700, amount_gbp: 9800 }, 1.27), 10000);
  // GBP order: just the GBP value
  assert.equal(inventoryCostFx({ currency: "GBP", amount_gbp: 5000 }, 1.27), 5000);
  // foreign but no costing rate → fall back to a booked stock valuation
  assert.equal(inventoryCostFx({ currency: "USD", amount_ccy: 12700, amount_gbp: 9800, stock_value_gbp: 10160 }, null), 10160);
  // foreign, no rate and no booked valuation → fall back to the GBP cash value
  assert.equal(inventoryCostFx({ currency: "USD", amount_ccy: 12700, amount_gbp: 9800 }, null), 9800);
});
