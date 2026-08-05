import test from "node:test";
import assert from "node:assert/strict";
import { cashOutYm, cashOutFromDate, cashOutFor, MINISO_TERMS_DAYS, summarise, parseProcurementCsv } from "../lib/procurement-rules.js";

test("cash-out month = order month-end + payment terms", () => {
  assert.equal(cashOutYm("2026-07", 60), "2026-09");   // 31 Jul + 60d = 29 Sep
  assert.equal(cashOutYm("2026-07", 30), "2026-08");   // 31 Jul + 30d = 30 Aug
  assert.equal(cashOutYm("2026-07", 0), "2026-07");    // due at month-end
  assert.equal(cashOutYm("2026-07", 14), "2026-08");   // 31 Jul + 14d = 14 Aug
});

test("Miniso HQ cash-out = pickup date + 180 days", () => {
  assert.equal(MINISO_TERMS_DAYS, 180);
  assert.equal(cashOutFromDate("2026-07-15", 180), "2027-01"); // 15 Jul 2026 + 180d = 11 Jan 2027
  assert.equal(cashOutFromDate("", 180), null);
  // Miniso with a pickup date uses pickup + 180; without one it falls back to order-month + its terms.
  assert.equal(cashOutFor({ source: "MINISO", pickup_date: "2026-07-15", order_ym: "2026-07", terms_days: 0 }), "2027-01");
  assert.equal(cashOutFor({ source: "MINISO", order_ym: "2026-07", terms_days: 60 }), "2026-09"); // legacy row, no pickup
  assert.equal(cashOutFor({ source: "LOCAL", order_ym: "2026-07", terms_days: 30 }), "2026-08");
});

test("summarise buckets committed spend into the cash-out month vs budget", () => {
  const purchases = [
    { source: "MINISO", supplier: "HQ", order_ym: "2026-07", amount_gbp: 400000, terms_days: 60, status: "COMMITTED" },
    { source: "MINISO", supplier: "HQ", order_ym: "2026-08", amount_gbp: 100000, terms_days: 60, status: "PAID" },
    { source: "LOCAL", supplier: "Design360", order_ym: "2026-07", amount_gbp: 42000, terms_days: 30, status: "COMMITTED" },
  ];
  const budgets = [
    { source: "MINISO", ym: "2026-09", budget_gbp: 300000 },
    { source: "LOCAL", ym: "2026-08", budget_gbp: 50000 },
  ];
  const s = summarise(purchases, budgets);
  // Miniso 400k ordered Jul/60d → cash-out Sep; budget 300k → over by 100k
  const sep = s.MINISO.months.find((m) => m.ym === "2026-09");
  assert.equal(sep.committed, 400000);
  assert.equal(sep.variance, -100000);
  assert.equal(sep.overBudget, true);
  // Local 42k ordered Jul/30d → Aug; budget 50k → 8k headroom, not over
  const aug = s.LOCAL.months.find((m) => m.ym === "2026-08");
  assert.equal(aug.committed, 42000);
  assert.equal(aug.variance, 8000);
  assert.equal(aug.overBudget, false);
  // supplier rollup carries terms
  assert.equal(s.MINISO.suppliers[0].terms_days, 60);
});

test("CSV parses sources, months, terms; bad rows error not load", () => {
  const csv = [
    "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference",
    "Miniso,MINISO HQ,Core,2026-07,\"420,000\",60,Committed,PO-1",
    "Local,Design360,Fixtures,07/2026,42000,30,Paid,PO-2",
    "Nowhere,X,Y,2026-07,100,30,Committed,PO-3",
    "Local,,Z,2026-07,100,30,Committed,PO-4",
  ].join("\n");
  const { records, errors } = parseProcurementCsv(csv);
  assert.equal(records.length, 2);
  assert.equal(records[0].amount_gbp, 420000);
  assert.equal(records[0].terms_days, 60);
  assert.equal(records[1].order_ym, "2026-07");
  assert.equal(records[1].status, "PAID");
  assert.equal(errors.length, 2);
});

import { canHodApprove, canFinanceApprove, canCancelProcurement, canDeleteProcurement, PROC_STATUS_META } from "../lib/procurement-rules.js";

test("approval lifecycle gates", () => {
  // HoD sign-off only from PENDING
  assert.equal(canHodApprove({ approval_status: "PENDING" }), true);
  assert.equal(canHodApprove({ approval_status: "HOD_APPROVED" }), false);
  assert.equal(canHodApprove({ approval_status: "APPROVED" }), false);
  // Finance can approve pending or head-approved
  assert.equal(canFinanceApprove({ approval_status: "PENDING" }), true);
  assert.equal(canFinanceApprove({ approval_status: "HOD_APPROVED" }), true);
  assert.equal(canFinanceApprove({ approval_status: "APPROVED" }), false);
  assert.equal(canFinanceApprove({ approval_status: "CANCELLED" }), false);
  // Cancel anything not already cancelled
  assert.equal(canCancelProcurement({ approval_status: "PENDING" }), true);
  assert.equal(canCancelProcurement({ approval_status: "APPROVED" }), true);
  assert.equal(canCancelProcurement({ approval_status: "CANCELLED" }), false);
});

test("delete gate: finance only, once head-approved", () => {
  // not finance → blocked
  assert.equal(canDeleteProcurement({ approval_status: "APPROVED" }, { isFinance: false }).ok, false);
  // finance but not yet head-approved → blocked
  const pending = canDeleteProcurement({ approval_status: "PENDING" }, { isFinance: true });
  assert.equal(pending.ok, false);
  assert.match(pending.reason, /Head of Department/);
  // finance + head-approved → allowed
  assert.equal(canDeleteProcurement({ approval_status: "HOD_APPROVED" }, { isFinance: true }).ok, true);
  assert.equal(canDeleteProcurement({ approval_status: "APPROVED" }, { isFinance: true }).ok, true);
  // admin override
  assert.equal(canDeleteProcurement({ approval_status: "PENDING" }, { isAdmin: true }).ok, true);
});

test("status meta covers every status", () => {
  for (const s of ["PENDING", "HOD_APPROVED", "APPROVED", "CANCELLED"]) assert.ok(PROC_STATUS_META[s]?.label);
});
