import { test } from "node:test";
import assert from "node:assert/strict";
import { isForeignRow, stockValue, fxToPL, inventoryCostFx, reportBasis, reportedGbp } from "../lib/procurement-close-rules.js";
import {
  financeActionError, displayStatus, committedAmount, lineValue, challengeReasonLabels,
  paymentStatusOf, isProcChallengeReason, procRef, isMerchRequest, PROC_FINANCE_STATUSES,
  settlesByLc, lcActionError, lcStatus, dcDrawdown, validateDc, normDcRef,
  PROC_PAYMENT_METHODS, isProcPaymentMethod, paymentMethodOf,
  CHALLENGE_REASON_NEEDS_NOTE, challengeNoteError, PROC_CHALLENGE_REASONS,
} from "../lib/procurement-close-rules.js";
const ruleLc = { settlesByLc, lcActionError, lcStatus };

test("PROC_PAYMENT_METHODS is Cash / Trade pay, and isProcPaymentMethod validates", () => {
  assert.deepEqual(PROC_PAYMENT_METHODS.map((m) => m.code), ["CASH", "TRADE_PAY"]);
  assert.deepEqual(PROC_PAYMENT_METHODS.map((m) => m.label), ["Cash", "Trade pay"]);
  assert.ok(isProcPaymentMethod("CASH"));
  assert.ok(isProcPaymentMethod("TRADE_PAY"));
  assert.ok(!isProcPaymentMethod("PAID"));     // that's a payment status, not a method
  assert.ok(!isProcPaymentMethod(""));
  assert.ok(!isProcPaymentMethod(null));
});

test("paymentMethodOf reads the row's method, null when unset or unknown", () => {
  assert.equal(paymentMethodOf({ payment_method: "CASH" }).label, "Cash");
  assert.equal(paymentMethodOf({ payment_method: "TRADE_PAY" }).label, "Trade pay");
  // Not paid yet, or paid before the method was captured.
  assert.equal(paymentMethodOf({}), null);
  assert.equal(paymentMethodOf({ payment_method: null }), null);
  assert.equal(paymentMethodOf({ payment_method: "BOGUS" }), null);
});

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
    { dc_reference: "DC UK1233788", dc_value: 200000, expected_payment_date: null, notes: null });
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

test("challenge reasons include Other, and Other requires a note", () => {
  const codes = PROC_CHALLENGE_REASONS.map((r) => r.code);
  assert.ok(codes.includes("OTHER"));
  assert.equal(PROC_CHALLENGE_REASONS.find((r) => r.code === "OTHER").label, "Other");
  assert.ok(isProcChallengeReason("OTHER"));
  assert.deepEqual(challengeReasonLabels("OTHER,INVOICE_VALUE"), ["Other", "Invoice value"]);
  // A fixed reason says what the query is on its own — no note needed.
  assert.equal(challengeNoteError(["INVOICE_VALUE"], ""), null);
  assert.equal(challengeNoteError([], ""), null);
  // "Other" does not, so it must be explained.
  assert.ok(challengeNoteError(["OTHER"], ""));
  assert.ok(challengeNoteError(["OTHER"], "   "));            // whitespace is not an explanation
  assert.ok(challengeNoteError(["INVOICE_VALUE", "OTHER"], "")); // still required alongside others
  assert.equal(challengeNoteError(["OTHER"], "Supplier changed the spec"), null);
  assert.equal(CHALLENGE_REASON_NEEDS_NOTE, "OTHER");
});

// ---- DC expected payment month, and the open balance it places ----
import { validateDc as validateDcExp, dcDrawdown as dcDrawdownExp } from "../lib/procurement-close-rules.js";

test("validateDc accepts a month, stores a date, and rejects nonsense", () => {
  // The picker gives 'YYYY-MM'; only the month is ever used, so it stores the 1st.
  assert.equal(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "2027-03" }).clean.expected_payment_date, "2027-03-01");
  // A full date is accepted as typed.
  assert.equal(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "2027-03-16" }).clean.expected_payment_date, "2027-03-16");
  // Optional — absent or blank is not an error, it just has no month.
  assert.equal(validateDcExp({ dc_reference: "DC UK1" }).clean.expected_payment_date, null);
  assert.equal(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "  " }).clean.expected_payment_date, null);
  assert.equal(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "" }).errors.length, 0);
  // Rubbish is refused rather than stored as null and quietly forgotten.
  assert.match(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "March" }).errors.join(), /YYYY-MM/);
  assert.match(validateDcExp({ dc_reference: "DC UK1", expected_payment_date: "2027-13" }).errors.join(), /not a real month/);
});

test("dcDrawdown reports the open balance and the month it lands in", () => {
  // The real shape from the desk: a DC of $220,000 with $209,355 drawn leaves
  // $10,645 of credit agreed but not yet drawn as an LC. That is a commitment
  // with no LC and therefore no date of its own — the DC's expected month places it.
  const [g] = dcDrawdownExp(
    [{ dc_id: 1, dc_reference: "DC UK1242544", dc_value: 220000, expected_payment_date: "2027-03-01" }],
    [{ dc_reference: "DC UK1242544", lc_amount: 209355 }]);
  assert.equal(g.used, 209355);
  assert.equal(g.remaining, 10645);
  assert.equal(g.openBalance, 10645);
  assert.equal(g.openMonth, "2027-03");
  assert.equal(g.openNeedsMonth, false);
});

test("dcDrawdown flags an open balance with nowhere to land", () => {
  // A DC with money still to draw and no expected month is the case the desk has
  // to ask about — otherwise it silently falls back to the pickup + 180 estimate.
  const [g] = dcDrawdownExp([{ dc_id: 1, dc_reference: "DCUK1246655", dc_value: 220000 }], []);
  assert.equal(g.openBalance, 220000);
  assert.equal(g.openMonth, null);
  assert.equal(g.openNeedsMonth, true);
});

test("dcDrawdown: a fully drawn or over-drawn DC has no open balance", () => {
  const [full] = dcDrawdownExp(
    [{ dc_id: 1, dc_reference: "A", dc_value: 220000, expected_payment_date: "2027-03-01" }],
    [{ dc_reference: "A", lc_amount: 220000 }]);
  assert.equal(full.openBalance, 0);
  assert.equal(full.openNeedsMonth, false);      // nothing open, so nothing to ask about

  // Over-drawn is a problem, but it is not open credit — it must not read as a
  // negative commitment and credit a month back.
  const [over] = dcDrawdownExp(
    [{ dc_id: 2, dc_reference: "B", dc_value: 220000 }],
    [{ dc_reference: "B", lc_amount: 230000 }]);
  assert.equal(over.remaining, -10000);
  assert.equal(over.over, true);
  assert.equal(over.openBalance, 0);
  assert.equal(over.openNeedsMonth, false);

  // A DC with no value recorded cannot have a known balance either way.
  const [novalue] = dcDrawdownExp([{ dc_id: 3, dc_reference: "C" }], []);
  assert.equal(novalue.openBalance, null);
  assert.equal(novalue.openNeedsMonth, false);
});

// ---- LC drawdown and the balance still committed ----
import { lcDrawdownGbp, lcBalanceGbp } from "../lib/procurement-close-rules.js";

// LC96 as it stands on the desk: $660,000 USD, costing rate 1.28 → £515,625
// inventory, with four LCs logged totalling $642,096.
const LC96 = {
  currency: "USD", amount_ccy: 660000, amount_gbp: 496241,
  lcs: [{ lc_amount: 209355 }, { lc_amount: 216109 }, { lc_amount: 214792 }, { lc_amount: 1840 }],
};
const COSTING = 660000 / 515625;   // the rate that gives the £515,625 on screen

test("lcDrawdownGbp values the logged LCs at the costing rate, like Inventory", () => {
  const drawn = lcDrawdownGbp(LC96, COSTING);
  assert.equal(drawn, 501637.5);                        // $642,096 at the same rate
  // Struck on the same basis as the Inventory column it sits beside, so the two
  // subtract cleanly.
  assert.equal(lcBalanceGbp(LC96, COSTING), round2ish(515625 - 501637.5));
});

function round2ish(n) { return Math.round(n * 100) / 100; }

test("lcBalanceGbp: nothing drawn leaves the whole order committed", () => {
  // LC97 — two DCs but no LC issued yet, so none of it is on the facility.
  const lc97 = { currency: "USD", amount_ccy: 662900.89, amount_gbp: 498422, lcs: [] };
  assert.equal(lcDrawdownGbp(lc97, COSTING), 0);
  assert.equal(lcBalanceGbp(lc97, COSTING), lcBalanceGbp({ ...lc97, lcs: undefined }, COSTING));
  // The balance is the full inventory value — exactly today's behaviour for a
  // request with no LCs, so nothing moves until one is drawn.
  assert.equal(lcBalanceGbp(lc97, COSTING), round2ish(662900.89 / COSTING));
});

test("lcBalanceGbp: a GBP order's LCs need no conversion", () => {
  const gbp = { currency: "GBP", amount_gbp: 50000, lcs: [{ lc_amount: 20000 }] };
  assert.equal(lcDrawdownGbp(gbp, null), 20000);
  assert.equal(lcBalanceGbp(gbp, null), 30000);
});

test("lcDrawdownGbp reports null, not zero, when a foreign order cannot be valued", () => {
  // Zero would read as "nothing drawn" and leave the whole order committed,
  // which is a confident wrong answer. Null lets the screen say it doesn't know.
  const noRate = { currency: "USD", amount_ccy: 660000, amount_gbp: 496241, lcs: [{ lc_amount: 209355 }] };
  assert.equal(lcDrawdownGbp(noRate, null), null);
  assert.equal(lcBalanceGbp(noRate, null), null);
  assert.equal(lcDrawdownGbp(noRate, 0), null);
  assert.equal(lcDrawdownGbp(noRate, -1), null);
  // With no LCs at all there is nothing to value, so zero is honest.
  assert.equal(lcDrawdownGbp({ currency: "USD", amount_ccy: 100, amount_gbp: 80, lcs: [] }, null), 0);
});

test("lcBalanceGbp goes negative when more is drawn than the order is worth", () => {
  // Over-drawn is a problem to surface, not to clamp away.
  const over = { currency: "GBP", amount_gbp: 10000, lcs: [{ lc_amount: 12000 }] };
  assert.equal(lcBalanceGbp(over, null), -2000);
});
