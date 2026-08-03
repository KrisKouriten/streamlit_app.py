import { test } from "node:test";
import assert from "node:assert/strict";
import {
  financeActionError, displayStatus, committedAmount, lineValue, challengeReasonLabels,
  paymentStatusOf, isProcChallengeReason, procRef, isMerchRequest, PROC_FINANCE_STATUSES,
} from "../lib/procurement-close-rules.js";

test("finance lifecycle gate — approve", () => {
  assert.equal(financeActionError("approve", { finance_status: "PENDING" }), null);
  assert.ok(financeActionError("approve", { finance_status: "APPROVED" }));
});

test("finance lifecycle gate — challenge / close need approval", () => {
  assert.ok(financeActionError("challenge", { finance_status: "PENDING" }));
  assert.ok(financeActionError("close", { finance_status: "PENDING" }));
  assert.equal(financeActionError("challenge", { finance_status: "APPROVED" }), null);
  assert.equal(financeActionError("close", { finance_status: "APPROVED" }), null);
  assert.equal(financeActionError("close", { finance_status: "CHALLENGED" }), null);
  assert.ok(financeActionError("close", { finance_status: "CLOSED" }));
  assert.ok(financeActionError("challenge", { finance_status: "CLOSED" }));
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
