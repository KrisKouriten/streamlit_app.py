import { test } from "node:test";
import assert from "node:assert/strict";
import { planOrderEdit, orderEditError } from "../lib/procurement-edit-rules.js";
import { ukPaymentDate, supplierDueDate, supplierTermsDate } from "../lib/supplier-terms-rules.js";
import { cashOutFor } from "../lib/procurement-rules.js";

const base = { source: "LOCAL", supplier: "Acme", approval_status: "APPROVED", amount_gbp: 1000, currency: "GBP", order_ym: "2026-09", terms_days: 30 };

test("locked: cancelled, closed by Finance, or paid", () => {
  assert.match(orderEditError({ ...base, approval_status: "CANCELLED" }), /cancelled/);
  assert.match(orderEditError({ ...base, finance_status: "CLOSED" }), /closed/);
  assert.match(orderEditError({ ...base, payment_status: "PAID" }), /paid/);
  assert.equal(orderEditError(base), null);
  assert.ok(planOrderEdit({ ...base, payment_status: "PAID" }, { amount: 5 }).error);
});

test("raising the amount on an approved order sends it back for approval; lowering doesn't", () => {
  const up = planOrderEdit(base, { amount: "1,200.00" });
  assert.equal(up.changes.amount, 1200);
  assert.equal(up.reapprove, true);
  const down = planOrderEdit(base, { amount: 800 });
  assert.equal(down.reapprove, false);
  assert.equal(planOrderEdit({ ...base, approval_status: "PENDING" }, { amount: 5000 }).reapprove, false);
  assert.deepEqual(planOrderEdit(base, { amount: 1000 }).changes, {});   // unchanged
  assert.ok(planOrderEdit(base, { amount: 0 }).error);
});

test("a foreign order's amount is compared in its own currency", () => {
  const usd = { ...base, currency: "USD", amount_ccy: 1300, amount_gbp: 1000 };
  assert.equal(planOrderEdit(usd, { amount: 1300 }).changes.amount, undefined);
  assert.equal(planOrderEdit(usd, { amount: 1350 }).reapprove, true);
});

test("dates: months, pickup (Miniso only) and the supplier payment date", () => {
  const p = planOrderEdit(base, { order_ym: "2026-10", delivery_ym: "", supplier_pay_date: "2026-11-15", pickup_date: "2026-01-01" });
  assert.deepEqual(p.changes, { order_ym: "2026-10", supplier_pay_date: "2026-11-15" });
  assert.ok(planOrderEdit(base, { order_ym: "Oct" }).error);
  const m = planOrderEdit({ ...base, source: "MINISO", pickup_date: "2026-04-01" }, { pickup_date: "2026-05-01" });
  assert.equal(m.changes.pickup_date, "2026-05-01");
  // Clearing the supplier payment date goes back to the terms.
  assert.deepEqual(planOrderEdit({ ...base, supplier_pay_date: "2026-11-15" }, { supplier_pay_date: "" }).changes, { supplier_pay_date: null });
});

test("Miniso UK payment date: 180 days on the invoice / pickup date, the cash budget month", () => {
  assert.equal(ukPaymentDate(base), "2027-03-29");                       // 30/09/2026 + 180
  assert.equal(cashOutFor(base), "2027-03");
  const miniso = { source: "MINISO", pickup_date: "2026-04-01", order_ym: "2026-03", terms_days: 180 };
  assert.equal(ukPaymentDate(miniso), "2026-09-28");
  assert.equal(cashOutFor(miniso), "2026-09");
});

test("supplier payment date: invoice date + terms, unless set on the order", () => {
  assert.equal(supplierTermsDate(base), "2026-10-30");
  assert.equal(supplierDueDate(base), "2026-10-30");
  assert.equal(supplierDueDate({ ...base, supplier_pay_date: "2026-11-15" }), "2026-11-15");
  assert.equal(supplierDueDate({ ...base, supplier_pay_date: "2026-11-15T00:00:00.000Z" }), "2026-11-15");
  // Setting it never moves the Miniso UK date.
  assert.equal(ukPaymentDate({ ...base, supplier_pay_date: "2026-11-15" }), "2027-03-29");
});
