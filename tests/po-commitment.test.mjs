import test from "node:test";
import assert from "node:assert/strict";
import { poCommitment } from "../lib/po-rules.js";

const po = (o = {}) => ({ status: "APPROVED", finance_status: "OPEN", payment_value: 1000, ...o });

test("a signed-off P.O with no invoice is open at its value", () => {
  assert.deepEqual(poCommitment(po()), { committed: 0, open: 1000, invoiced: 0, balance: 0, partInvoiced: false });
  assert.equal(poCommitment(po({ status: "PENDING_SIGNOFF" })).open, 1000);
  assert.equal(poCommitment(po({ invoice_amount: 0 })).open, 1000);
});

test("from the first invoice the whole P.O is committed: invoiced + balance", () => {
  const c = poCommitment(po({ invoice_amount: 400 }));
  assert.equal(c.partInvoiced, true);
  assert.equal(c.invoiced, 400);
  assert.equal(c.balance, 600);
  assert.equal(c.committed, 1000);
  assert.equal(c.open, 0);
});

test("an invoice over the P.O value counts in full, with no balance", () => {
  const c = poCommitment(po({ invoice_amount: 1150.5 }));
  assert.equal(c.committed, 1150.5);
  assert.equal(c.balance, 0);
});

test("a closed P.O commits its invoice net; the balance is released", () => {
  assert.equal(poCommitment(po({ finance_status: "CLOSED", invoice_amount: 800 })).committed, 800);
  assert.equal(poCommitment(po({ finance_status: "CLOSED" })).committed, 1000);
  assert.equal(poCommitment(po({ finance_status: "CLOSED", invoice_amount: 800 })).open, 0);
});

test("cancelled and rejected P.Os count nowhere", () => {
  for (const status of ["CANCELLED", "REJECTED"]) {
    const c = poCommitment(po({ status, invoice_amount: 400 }));
    assert.equal(c.committed, 0);
    assert.equal(c.open, 0);
  }
});

test("a challenged part-invoiced P.O stays committed", () => {
  assert.equal(poCommitment(po({ finance_status: "CHALLENGED", invoice_amount: 250 })).committed, 1000);
});
