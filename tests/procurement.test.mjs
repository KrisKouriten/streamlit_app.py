import test from "node:test";
import assert from "node:assert/strict";
import { cashOutYm, cashOutFromDate, cashOutFor, MINISO_TERMS_DAYS, summarise, parseProcurementCsv,
  facilitySourceOf, tradeSpendByMonth, cashSpendByMonth } from "../lib/procurement-rules.js";

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

// ---- Spent: trade pay (facility upload) + cash, migration 113 ----

test("facilitySourceOf maps the procurement cost drivers, ignores the rest", () => {
  assert.equal(facilitySourceOf({ cost_driver: "Miniso LC's" }), "MINISO");
  assert.equal(facilitySourceOf({ cost_driver: "Local Purchase" }), "LOCAL");
  assert.equal(facilitySourceOf({ cost_driver: "local purchase" }), "LOCAL");   // case
  assert.equal(facilitySourceOf({ cost_driver: "  Miniso   LCs " }), "MINISO"); // spacing / no apostrophe
  assert.equal(facilitySourceOf({ cost_driver: "Miniso LC’s" }), "MINISO");    // curly apostrophe
  // The column is typed by hand, so the PHRASE is what matches, not the exact string.
  assert.equal(facilitySourceOf({ cost_driver: "Miniso LC" }), "MINISO");           // singular
  assert.equal(facilitySourceOf({ cost_driver: "MinisoLCs" }), "MINISO");           // no space
  assert.equal(facilitySourceOf({ cost_driver: "Local Purchases" }), "LOCAL");      // plural
  assert.equal(facilitySourceOf({ cost_driver: "Local purchase - toys" }), "LOCAL");// trailing detail
  // Not procurement. Miniso Investment is intercompany funding — the loose
  // matching must not swallow it just because it starts with "Miniso".
  assert.equal(facilitySourceOf({ cost_driver: "Opex" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Capex" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Miniso Investment" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Miniso" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "   " }), null);
  assert.equal(facilitySourceOf({}), null);
});

test("tradeSpendByMonth sums the facility upload by source and DUE month", () => {
  const spend = tradeSpendByMonth([
    { cost_driver: "Miniso LC's", due_date: "2027-01-11", facility_payment_gbp: 142567.3 },
    { cost_driver: "Miniso LC's", due_date: "2027-01-06", facility_payment_gbp: 84099.6 },
    { cost_driver: "Miniso LC's", due_date: "2026-12-30", facility_payment_gbp: 113720 },
    { cost_driver: "Local Purchase", due_date: "2027-01-06", facility_payment_gbp: 22498.56 },
    { cost_driver: "Opex", due_date: "2027-01-06", facility_payment_gbp: 999999 },  // not procurement
    { cost_driver: "Local Purchase", due_date: null, facility_payment_gbp: 500 },   // no date to land on
  ]);
  assert.equal(Math.round(spend.MINISO["2027-01"]), 226667);
  assert.equal(spend.MINISO["2026-12"], 113720);
  assert.equal(spend.LOCAL["2027-01"], 22498.56);
  assert.equal(spend.LOCAL["2026-12"], undefined);
});

test("tradeSpendByMonth: the due date wins over payment_month, which is only a fallback", () => {
  // A Miniso post-shipment loan drawn down in July is not spend until it is repaid.
  const late = tradeSpendByMonth([
    { cost_driver: "Miniso LC's", due_date: "2027-01-11", payment_month: "2026-07", facility_payment_gbp: 1000 },
  ]);
  assert.equal(late.MINISO["2027-01"], 1000);
  assert.equal(late.MINISO["2026-07"], undefined);
  // No due date on the row — fall back rather than drop the spend.
  const fallback = tradeSpendByMonth([
    { cost_driver: "Local Purchase", due_date: null, payment_month: "2027-03", facility_payment_gbp: 10 },
  ]);
  assert.equal(fallback.LOCAL["2027-03"], 10);
});

test("cashSpendByMonth counts only CASH rows — trade pay comes from the facility, not here", () => {
  const spend = cashSpendByMonth([
    { source: "LOCAL", amount_gbp: 5000, payment_method: "CASH", paid_date: "2027-01-14", order_ym: "2026-07", terms_days: 60 },
    { source: "LOCAL", amount_gbp: 1000, payment_method: "CASH", paid_date: "2027-01-28", order_ym: "2026-07", terms_days: 60 },
    // Already reported by the facility upload — counting it here would double up.
    { source: "LOCAL", amount_gbp: 90000, payment_method: "TRADE_PAY", paid_date: "2027-01-10", order_ym: "2026-07", terms_days: 60 },
    // Paid before the method was captured — not guessed at.
    { source: "MINISO", amount_gbp: 70000, payment_method: null, paid_date: "2027-01-10", order_ym: "2026-07", terms_days: 60 },
    // No paid date recorded → falls back to the cash-out month (31 Jul + 60d = Sep).
    { source: "MINISO", amount_gbp: 2500, payment_method: "CASH", paid_date: null, order_ym: "2026-07", terms_days: 60 },
  ]);
  assert.equal(spend.LOCAL["2027-01"], 6000);
  assert.equal(spend.MINISO["2027-01"], undefined);
  assert.equal(spend.MINISO["2026-09"], 2500);
});

test("summarise splits spent into trade pay + cash against the budget", () => {
  const purchases = [
    { source: "LOCAL", supplier: "Korea Foods", order_ym: "2026-07", terms_days: 60, amount_gbp: 20000, status: "COMMITTED", payment_method: "CASH", paid_date: "2026-09-10" },
    { source: "LOCAL", supplier: "DKB Toys", order_ym: "2026-07", terms_days: 60, amount_gbp: 30000, status: "COMMITTED", payment_method: "TRADE_PAY", paid_date: "2026-09-12" },
  ];
  const budgets = [{ source: "LOCAL", ym: "2026-09", budget_gbp: 60000 }];
  const spend = {
    trade: tradeSpendByMonth([{ cost_driver: "Local Purchase", due_date: "2026-09-29", facility_payment_gbp: 30000 }]),
    cash: cashSpendByMonth(purchases),
  };
  const m = summarise(purchases, budgets, spend).LOCAL.months.find((x) => x.ym === "2026-09");
  assert.equal(m.committed, 50000);
  assert.equal(m.tradeSpent, 30000);
  assert.equal(m.cashSpent, 20000);
  assert.equal(m.spent, 50000);
  assert.equal(m.variance, 10000);        // budget − committed
  assert.equal(m.spentVariance, 10000);   // budget − spent
  assert.equal(m.overBudget, false);
  assert.equal(m.overSpent, false);
  const s = summarise(purchases, budgets, spend).LOCAL;
  assert.equal(s.totalTradeSpent, 30000);
  assert.equal(s.totalCashSpent, 20000);
  assert.equal(s.totalSpent, 50000);
});

test("summarise without any spend reads zero, and a settlement-only month still gets a row", () => {
  // No facility upload and nothing tagged yet — the spend columns must not break.
  const bare = summarise([{ source: "LOCAL", supplier: "X", order_ym: "2026-07", terms_days: 60, amount_gbp: 100, status: "COMMITTED" }], []);
  const m = bare.LOCAL.months.find((x) => x.ym === "2026-09");
  assert.equal(m.spent, 0);
  assert.equal(m.tradeSpent, 0);
  assert.equal(m.cashSpent, 0);
  assert.equal(m.spentVariance, null);    // no budget to compare against
  assert.equal(bare.LOCAL.totalSpent, 0);
  // Spend can land in a month with no order or budget of its own — show it anyway.
  const only = summarise([], [], { trade: tradeSpendByMonth([{ cost_driver: "Miniso LC's", due_date: "2027-05-18", facility_payment_gbp: 1234 }]) });
  assert.deepEqual(only.MINISO.months.map((x) => x.ym), ["2027-05"]);
  assert.equal(only.MINISO.months[0].spent, 1234);
  assert.equal(only.MINISO.months[0].committed, 0);
});

test("summarise flags a month that is within committed budget but overspent", () => {
  const budgets = [{ source: "MINISO", ym: "2026-09", budget_gbp: 1000 }];
  const spend = { trade: tradeSpendByMonth([{ cost_driver: "Miniso LC's", due_date: "2026-09-30", facility_payment_gbp: 1500 }]) };
  const m = summarise([], budgets, spend).MINISO.months[0];
  assert.equal(m.overBudget, false);      // nothing committed
  assert.equal(m.overSpent, true);        // but £1,500 has gone out against a £1,000 budget
  assert.equal(m.spentVariance, -500);
});
