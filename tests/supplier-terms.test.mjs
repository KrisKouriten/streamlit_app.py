import { test } from "node:test";
import assert from "node:assert/strict";
import { supplierDueDate, supplierTermsPosition } from "../lib/supplier-terms-rules.js";

const TODAY = "2026-10-02";
const o = (x) => ({ source: "LOCAL", supplier: "Acme", approval_status: "APPROVED", terms_days: 30, amount_gbp: 1000, ...x });

test("due date: order month-end plus terms; Miniso from pickup", () => {
  assert.equal(supplierDueDate(o({ order_ym: "2026-08" })), "2026-09-30");
  assert.equal(supplierDueDate(o({ order_ym: "2026-09", terms_days: 60 })), "2026-11-29");
  assert.equal(supplierDueDate({ source: "MINISO", pickup_date: "2026-04-01", terms_days: 180, order_ym: "2026-03" }), "2026-09-28");
  assert.equal(supplierDueDate(o({ order_ym: null })), null);
});

test("paid orders free the terms; cancelled and draft orders don't count", () => {
  const rows = supplierTermsPosition([
    o({ order_ym: "2026-09" }),
    o({ order_ym: "2026-09", payment_status: "PAID" }),
    o({ order_ym: "2026-09", approval_status: "CANCELLED" }),
    o({ order_ym: "2026-09", request_status: "DRAFT" }),
  ], [{ name: "acme ", credit_limit: 5000 }], TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].open, 1000);
  assert.equal(rows[0].openOrders, 1);
  assert.equal(rows[0].orders, 2);          // live orders, paid included
  assert.equal(rows[0].limit, 5000);
  assert.equal(rows[0].available, 4000);
});

test("due buckets: due now, next 30 days, later; next due frees up the balance", () => {
  const [r] = supplierTermsPosition([
    o({ order_ym: "2026-08", amount_gbp: 100 }),                  // due 30/09 — overdue
    o({ order_ym: "2026-09", amount_gbp: 200 }),                  // due 30/10 — within 30 days
    o({ order_ym: "2026-09", amount_gbp: 50 }),                   // same day
    o({ order_ym: "2026-10", amount_gbp: 400, terms_days: 60 }),  // due 30/12 — later
  ], [], TODAY);
  assert.equal(r.dueNow, 100);
  assert.equal(r.due30, 250);
  assert.equal(r.later, 400);
  assert.deepEqual(r.nextDue, { date: "2026-10-30", amount: 250 });
  assert.equal(r.limit, null);
  assert.equal(r.available, null);
});

test("still-committed balance is used (e.g. a part-drawn LC), and awaiting approval is shown", () => {
  const [r] = supplierTermsPosition([
    o({ order_ym: "2026-09", committed_gbp: 300 }),
    o({ order_ym: "2026-09", approval_status: "PENDING" }),
  ], [{ name: "Acme", credit_limit: 1000, payment_days: 45 }], TODAY);
  assert.equal(r.open, 1300);
  assert.equal(r.awaiting, 1000);
  assert.equal(r.terms_days, 45);
  assert.equal(r.over, true);
  assert.equal(r.available, -300);
});

test("aged against the terms: current, 1–30, 31–60 and 60+ days past due", () => {
  const [r] = supplierTermsPosition([
    o({ order_ym: "2026-09", amount_gbp: 100 }),   // due 30/10 — current
    o({ order_ym: "2026-08", amount_gbp: 200 }),   // due 30/09 — 2 days past
    o({ order_ym: "2026-07", amount_gbp: 300 }),   // due 30/08 — 33 days past
    o({ order_ym: "2026-05", amount_gbp: 400 }),   // due 30/06 — 94 days past
  ], [], TODAY);
  assert.equal(r.current, 100);
  assert.equal(r.od30, 200);
  assert.equal(r.od60, 300);
  assert.equal(r.od60plus, 400);
  assert.equal(r.overdue, 900);
  assert.equal(r.oldestDays, 124);   // invoiced 31/05, 124 days ago
});
