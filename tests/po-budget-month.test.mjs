import test from "node:test";
import assert from "node:assert/strict";
import { poBudgetByMonth } from "../lib/po-rules.js";

const po = (o) => ({ status: "APPROVED", finance_status: "OPEN", payment_value: 100, po_date: "2026-03-10", ...o });

test("P.Os land in their P.O month, committed or open as on the dashboard", () => {
  const r = poBudgetByMonth({
    year: 2026, budgetMonths: Array(12).fill(1000), card: 50,
    pos: [
      po({}),                                                                  // open, March
      po({ invoice_amount: 40 }),                                              // part-invoiced → committed 100, March
      po({ finance_status: "CLOSED", invoice_amount: 90, po_date: "2026-05-02" }), // closed → 90, May
      po({ finance_status: "CLOSED", po_date: "2025-12-01" }),                  // closed last year → left out
      po({ po_date: "2025-11-20" }),                                           // open from last year → Other years
      po({ status: "CANCELLED" }),                                             // nowhere
      po({ status: "PENDING_SIGNOFF", payment_value: 30 }),                    // awaiting sign-off → open, March
    ],
  });
  assert.deepEqual(r.months[2], { month: 3, budget: 1000, committed: 100, open: 130, remaining: 770 });
  assert.deepEqual(r.months[4], { month: 5, budget: 1000, committed: 90, open: 0, remaining: 910 });
  assert.deepEqual(r.other, { committed: 0, open: 100 });
  assert.deepEqual(r.totals, { budget: 12000, committed: 190, open: 230, card: 50, remaining: 11530 });
});

test("without a budget the P.Os still add up", () => {
  const r = poBudgetByMonth({ year: 2026, pos: [po({})] });
  assert.equal(r.hasBudget, false);
  assert.equal(r.months[2].remaining, null);
  assert.deepEqual(r.totals, { budget: null, committed: 0, open: 100, card: 0, remaining: null });
});
