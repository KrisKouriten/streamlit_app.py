import test from "node:test";
import assert from "node:assert/strict";
import { deskView, isPaidOrder, deskSuppliers, sameSupplier } from "../lib/procurement-close-rules.js";

const local = (o = {}) => ({ source: "LOCAL", finance_status: "APPROVED", approval_status: "APPROVED", payment_status: "UNPAID", ...o });
const views = (r) => Object.keys(deskView).filter((k) => deskView[k](r));

test("each order lands in the right desk view", () => {
  assert.deepEqual(views(local({ finance_status: "PENDING" })), ["needsApproval"]);
  assert.deepEqual(views(local()), ["unpaid"]);
  assert.deepEqual(views(local({ payment_status: "PART_PAID" })), ["unpaid"]);
  assert.deepEqual(views(local({ payment_status: "PAID", payment_method: "CASH" })), ["paid"]);
  assert.deepEqual(views(local({ finance_status: "CHALLENGED" })), ["challenged"]);
  assert.deepEqual(views(local({ finance_status: "CLOSED", payment_status: "PAID" })), []);
  assert.deepEqual(views(local({ approval_status: "CANCELLED", finance_status: "PENDING" })), []);
});

test("paid on trade pay without a facility record is called out", () => {
  const tp = (trade_pay, extra = {}) => local({ payment_status: "PAID", payment_method: "TRADE_PAY", trade_pay_ref: "WCTUKA093060", trade_pay, ...extra });
  assert.deepEqual(views(tp({ state: "matched" })), ["paid"]);
  assert.deepEqual(views(tp({ state: "unmatched" })), ["paid", "noFacility"]);
  assert.deepEqual(views(tp({ state: "unknown" })), ["paid", "noFacility"]);
  assert.deepEqual(views(tp(undefined, { trade_pay_ref: null })), ["paid", "noFacility"]);   // no reference at all
  assert.deepEqual(views(tp({ state: "unmatched" }, { finance_status: "CLOSED" })), []);
});

test("a Miniso order is paid when its LC settles, or when paid outside the LC", () => {
  const miniso = (o) => ({ source: "MINISO", finance_status: "APPROVED", ...o });
  assert.equal(isPaidOrder(miniso({ lc_reference: "LC1" })), false);
  assert.equal(isPaidOrder(miniso({ lc_settled: true })), true);
  assert.equal(isPaidOrder(miniso({ payment_status: "PAID", payment_method: "TRADE_PAY" })), true);
});

test("the supplier picker lists each supplier once, however it was typed", () => {
  const rows = [{ supplier: "Bandai UK Limited" }, { supplier: " bandai uk  limited" }, { supplier: "FINIECO" }, { supplier: "" }];
  assert.deepEqual(deskSuppliers(rows), ["Bandai UK Limited", "FINIECO"]);
  assert.equal(sameSupplier(rows[1], "Bandai UK Limited"), true);
  assert.equal(sameSupplier(rows[2], "Bandai UK Limited"), false);
});
