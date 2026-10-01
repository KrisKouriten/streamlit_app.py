import test from "node:test";
import assert from "node:assert/strict";
import { invoiceMatch, deptInvoiceError, deptCanRemoveInvoice } from "../lib/po-rules.js";

test("invoice against P.O: none, match, still to invoice, over", () => {
  assert.equal(invoiceMatch(1000, 0).state, "none");
  assert.deepEqual(invoiceMatch(1000, 1000.004), { state: "match", diff: 0, label: "Invoice matches the P.O", tone: "green" });
  const under = invoiceMatch(1000, 400);
  assert.equal(under.state, "under");
  assert.equal(under.diff, -600);
  assert.equal(under.label, "£600.00 of the P.O still to invoice");
  const over = invoiceMatch(1000, 1050.5);
  assert.equal(over.state, "over");
  assert.match(over.label, /£50\.50 over the P\.O/);
});

test("the raiser or the head enters invoices on a signed-off P.O until it is closed", () => {
  const po = { status: "APPROVED", finance_status: "OPEN" };
  assert.equal(deptInvoiceError(po, { isRaiser: true }), null);
  assert.equal(deptInvoiceError(po, { isHead: true }), null);
  assert.match(deptInvoiceError(po, {}), /raised this P\.O/);
  assert.match(deptInvoiceError({ status: "PENDING_SIGNOFF" }, { isRaiser: true }), /not been signed off/);
  assert.match(deptInvoiceError({ ...po, finance_status: "CLOSED" }, { isRaiser: true }), /closed/);
  assert.equal(deptCanRemoveInvoice({ invoice_status: "RECEIVED" }), true);
  assert.equal(deptCanRemoveInvoice({ invoice_status: "PROCESSING" }), false);
});

test("the raiser of a Local purchase enters its invoice once approved, until closed", async () => {
  const { orderInvoiceError } = await import("../lib/procurement-rules.js");
  const o = { source: "LOCAL", approval_status: "APPROVED", finance_status: "PENDING" };
  assert.equal(orderInvoiceError(o, { isRaiser: true }), null);
  assert.equal(orderInvoiceError(o, { canManage: true }), null);
  assert.match(orderInvoiceError(o, {}), /raised this order/);
  assert.match(orderInvoiceError({ ...o, source: "MINISO" }, { isRaiser: true }), /LC/);
  assert.match(orderInvoiceError({ ...o, approval_status: "PENDING" }, { isRaiser: true }), /once the order is approved/);
  assert.match(orderInvoiceError({ ...o, approval_status: "CANCELLED" }, { isRaiser: true }), /cancelled/);
  assert.match(orderInvoiceError({ ...o, finance_status: "CLOSED" }, { isRaiser: true }), /closed/);
});
