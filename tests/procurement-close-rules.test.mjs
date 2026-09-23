import { test } from "node:test";
import assert from "node:assert/strict";
import { isForeignRow, stockValue, fxToPL, inventoryCostFx, reportBasis, reportedGbp,
  normTradePayRef,
  tradePayRefError,
  tradePayMatch,
  outstandingCommitment
} from "../lib/procurement-close-rules.js";
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

// ---- Which drawing a trade-pay row settled on (migration 115) ----
//
// Migration 113 records HOW a purchase was paid. It does not record WHICH
// drawing, so a row tagged TRADE_PAY could not be tied to the HSBC facility and
// the two registers had to be reconciled by eye. The point of the link: close a
// procurement order once the loan behind it is repaid in full.

test("normTradePayRef ignores case and whitespace", () => {
  assert.equal(normTradePayRef(" wctuka096701 "), "WCTUKA096701");
  assert.equal(normTradePayRef("WCTUKA 096701"), "WCTUKA096701");
  assert.equal(normTradePayRef(""), "");
  assert.equal(normTradePayRef(null), "");
  assert.equal(normTradePayRef(undefined), "");
});

test("tradePayRefError: a reference belongs only on a trade-pay row", () => {
  assert.equal(tradePayRefError("TRADE_PAY", "WCTUKA096701"), null);
  assert.equal(tradePayRefError("TRADE_PAY", "LAIUK1076002"), null);
  assert.equal(tradePayRefError("TRADE_PAY", ""), null);          // optional
  assert.equal(tradePayRefError("CASH", ""), null);
  assert.equal(tradePayRefError(null, null), null);
  // Cash has no drawing — a reference on it would reconcile against something
  // that paid for a different purchase entirely.
  assert.match(tradePayRefError("CASH", "WCTUKA096701"), /only applies/);
  assert.match(tradePayRefError(null, "WCTUKA096701"), /only applies/);
  // Shape.
  assert.match(tradePayRefError("TRADE_PAY", "WC"), /too short/);
  assert.match(tradePayRefError("TRADE_PAY", "W".repeat(41)), /too long/);
  assert.match(tradePayRefError("TRADE_PAY", "WCTUK@096701"), /letters, digits/);
});

test("tradePayMatch: not found is a warning, never a refusal", () => {
  const refs = new Set(["WCTUKA096701", "WCTUKA095259"]);
  const of = (ref, method = "TRADE_PAY") => tradePayMatch({ payment_method: method, trade_pay_ref: ref }, refs);

  assert.equal(of("WCTUKA096701").state, "matched");
  assert.equal(of(" wctuka096701 ").state, "matched");           // normalised both sides
  assert.match(of("WCTUKA096701").label, /Reconciles/);

  // THE POINT. The HSBC extract is uploaded periodically, so a genuine reference
  // may not be loaded yet. Flagged, not refused.
  const miss = of("WCTUKA099999");
  assert.equal(miss.state, "unmatched");
  assert.equal(miss.tone, "amber");
  assert.match(miss.label, /not on the facility register/);

  // Trade pay with no reference at all cannot be reconciled, and says so.
  assert.equal(of("").state, "missing");
  assert.equal(of(null).state, "missing");

  // Cash rows are not in this conversation.
  assert.equal(of("WCTUKA096701", "CASH").state, "n/a");
  assert.equal(of("", "CASH").state, "n/a");
  assert.equal(of(null, null).state, "n/a");
});

test("tradePayMatch: an unreadable facility is unknown, not unmatched", () => {
  // Before migration 077, or when the register cannot be read, a reference must
  // not be reported as wrong — we simply cannot say.
  const m = tradePayMatch({ payment_method: "TRADE_PAY", trade_pay_ref: "WCTUKA096701" }, null);
  assert.equal(m.state, "unknown");
  assert.equal(m.ref, "WCTUKA096701");
  assert.match(m.label, /cannot be checked/);
  // An empty register is different from an absent one: there it genuinely is not present.
  assert.equal(tradePayMatch({ payment_method: "TRADE_PAY", trade_pay_ref: "WCTUKA096701" }, new Set()).state, "unmatched");
});

// ---- What a purchase still commits, whatever it settles on ----
//
// The LC drawdown / LC balance pair only meant anything for Miniso. A Local
// Purchase showed a dash in both — which is not "nothing to say", it is the same
// question with a different answer. And a Local order settled on trade pay is a
// drawing on the facility, which the desk ALREADY reports as spend: leaving it
// committed charges the month twice for the same money, the exact double count
// that made every Miniso month read over.

const local = (extra = {}) => ({ source: "LOCAL", amount_gbp: 5000, ...extra });

test("outstandingCommitment: an unsettled Local order commits its full value", () => {
  const oc = outstandingCommitment(local());
  assert.equal(oc.drawn, null);
  assert.equal(oc.balance, 5000);
  assert.equal(oc.closable, false);
  // Committed, not paid — a dash here used to be the only answer available.
  assert.equal(oc.note, "still committed");
});

test("outstandingCommitment: cash settles it — balance nil", () => {
  const oc = outstandingCommitment(local({ payment_status: "PAID", payment_method: "CASH" }));
  assert.equal(oc.drawn, 5000);
  assert.equal(oc.balance, 0);
  assert.equal(oc.note, "settled in cash");
  assert.equal(oc.closable, true);
});

test("outstandingCommitment: trade pay commits nothing, because the facility reports it", () => {
  const open = outstandingCommitment(local({
    payment_status: "PAID", payment_method: "TRADE_PAY",
    trade_pay: { state: "matched", ref: "WCTUKA096701" }, trade_pay_settled: false,
  }));
  assert.equal(open.balance, 0, "a trade-pay drawing is already spend on the facility");
  assert.equal(open.drawn, 5000);
  assert.equal(open.closable, false);          // the loan is still outstanding

  // The facility saying the loan is repaid is what makes the order closable.
  const done = outstandingCommitment(local({
    payment_status: "PAID", payment_method: "TRADE_PAY",
    trade_pay: { state: "matched", ref: "WCTUKA096701" }, trade_pay_settled: true,
  }));
  assert.equal(done.closable, true);
  assert.match(done.note, /ready to close/);
});

test("outstandingCommitment: a trade-pay row with no usable reference says so", () => {
  const noRef = outstandingCommitment(local({ payment_status: "PAID", payment_method: "TRADE_PAY", trade_pay: { state: "missing" } }));
  assert.equal(noRef.tone, "amber");
  assert.match(noRef.note, /no drawing reference/);

  const bad = outstandingCommitment(local({ payment_status: "PAID", payment_method: "TRADE_PAY", trade_pay: { state: "unmatched", ref: "WC999" } }));
  assert.equal(bad.tone, "amber");
  assert.match(bad.note, /not on the facility/);
});

test("outstandingCommitment: paid with no method recorded is flagged, not guessed", () => {
  // Tagging it either way would move real money between Cash and Trade pay on
  // the desk. The balance still clears, because the money has gone.
  const oc = outstandingCommitment(local({ payment_status: "PAID" }));
  assert.equal(oc.balance, 0);
  assert.equal(oc.tone, "amber");
  assert.match(oc.note, /not recorded/);
  assert.equal(oc.closable, false);
});

test("outstandingCommitment: Miniso keeps the LC balance it already had", () => {
  const miniso = { source: "MINISO", currency: "USD", amount_ccy: 100000, lc_drawn_ccy: 40000 };
  const oc = outstandingCommitment(miniso, 1.28);
  // inventory 100,000/1.28 = 78,125; drawn 40,000/1.28 = 31,250; balance 46,875.
  assert.equal(Math.round(oc.drawn), 31250);
  assert.equal(Math.round(oc.balance), 46875);
  assert.equal(oc.note, "still committed");
  // Over-drawn stays visible rather than clamping to zero.
  const over = outstandingCommitment({ source: "MINISO", currency: "USD", amount_ccy: 10000, lc_drawn_ccy: 20000 }, 1.28);
  assert.ok(over.balance < 0);
  assert.equal(over.tone, "red");
  assert.match(over.note, /drawn over/);
});
