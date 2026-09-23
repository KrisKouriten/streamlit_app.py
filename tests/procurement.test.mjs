import test from "node:test";
import assert from "node:assert/strict";
import { cashOutYm, cashOutFromDate, cashOutFor, MINISO_TERMS_DAYS, LOCAL_FACILITY_DAYS,
  tradeFacilitySplit, summarise, parseProcurementCsv,
  facilitySourceOf, tradeSpendByMonth, cashSpendByMonth, budgetImpact, requestsVsBudget,
  parseMonthHeader, parseBudgetSource, parseBudgetGridCsv, BUDGET_CSV_TEMPLATE, findMonthHeaderRow, facilityGbp } from "../lib/procurement-rules.js";

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
  // Local settles on the 180-day facility, so its own terms do not move the
  // cash-out: 31 Jul + 180d = 27 Jan 2027, whatever the supplier terms say.
  assert.equal(cashOutFor({ source: "LOCAL", order_ym: "2026-07", terms_days: 30 }), "2027-01");
  assert.equal(cashOutFor({ source: "LOCAL", order_ym: "2026-07", terms_days: 90 }), "2027-01");
});

test("summarise buckets committed spend into the cash-out month vs budget", () => {
  const purchases = [
    { source: "MINISO", supplier: "HQ", order_ym: "2026-07", amount_gbp: 400000, terms_days: 60, status: "COMMITTED" },
    { source: "MINISO", supplier: "HQ", order_ym: "2026-08", amount_gbp: 100000, terms_days: 60, status: "PAID" },
    { source: "LOCAL", supplier: "Design360", order_ym: "2026-07", amount_gbp: 42000, terms_days: 30, status: "COMMITTED" },
  ];
  const budgets = [
    { source: "MINISO", ym: "2026-09", budget_gbp: 300000 },
    { source: "LOCAL", ym: "2027-01", budget_gbp: 50000 },
  ];
  const s = summarise(purchases, budgets);
  // Miniso 400k ordered Jul/60d → cash-out Sep; budget 300k → over by 100k
  const sep = s.MINISO.months.find((m) => m.ym === "2026-09");
  assert.equal(sep.committed, 400000);
  assert.equal(sep.variance, -100000);
  assert.equal(sep.overBudget, true);
  // Local 42k ordered Jul → facility 180d → Jan 2027 (its 30-day supplier terms
  // decide the drawdown, not our cash-out); budget 50k → 8k headroom.
  const jan = s.LOCAL.months.find((m) => m.ym === "2027-01");
  assert.equal(jan.committed, 42000);
  assert.equal(jan.variance, 8000);
  assert.equal(jan.overBudget, false);
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
  // Miniso stock arrives two ways: an LC buyer loan, or TradePay against the
  // facility. Both are procurement — the real extract carries both wordings.
  assert.equal(facilitySourceOf({ cost_driver: "Miniso Facility" }), "MINISO");
  assert.equal(facilitySourceOf({ cost_driver: "miniso facilities" }), "MINISO");
  assert.equal(facilitySourceOf({ cost_driver: "MinisoFacility" }), "MINISO");
  // Not procurement. Miniso Investment is intercompany funding — the loose
  // matching must not swallow it just because it starts with "Miniso".
  assert.equal(facilitySourceOf({ cost_driver: "Opex" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Capex" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Miniso Investment" }), null);
  assert.equal(facilitySourceOf({ cost_driver: "Miniso Investment Hong Kong" }), null);
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
    { source: "LOCAL", amount_gbp: 5000, payment_method: "CASH", paid_date: "2027-01-14", order_ym: "2026-03", terms_days: 60 },
    { source: "LOCAL", amount_gbp: 1000, payment_method: "CASH", paid_date: "2027-01-28", order_ym: "2026-03", terms_days: 60 },
    // Already reported by the facility upload — counting it here would double up.
    { source: "LOCAL", amount_gbp: 90000, payment_method: "TRADE_PAY", paid_date: "2027-01-10", order_ym: "2026-03", terms_days: 60 },
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
    { source: "LOCAL", supplier: "Korea Foods", order_ym: "2026-03", terms_days: 60, amount_gbp: 20000, status: "COMMITTED", payment_method: "CASH", paid_date: "2026-09-10" },
    { source: "LOCAL", supplier: "DKB Toys", order_ym: "2026-03", terms_days: 60, amount_gbp: 30000, status: "COMMITTED", payment_method: "TRADE_PAY", paid_date: "2026-09-12" },
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
  // Variance = budget − committed − trade pay − cash, as Finance define it.
  assert.equal(m.variance, 60000 - 50000 - 30000 - 20000);   // −40,000
  assert.equal(m.spentVariance, 10000);              // budget − spent, unchanged
  assert.equal(m.overBudget, true);
  assert.equal(m.overSpent, false);                  // only £50k has actually settled
  const s = summarise(purchases, budgets, spend).LOCAL;
  assert.equal(s.totalTradeSpent, 30000);
  assert.equal(s.totalCashSpent, 20000);
  assert.equal(s.totalSpent, 50000);
});

test("summarise without any spend reads zero, and a settlement-only month still gets a row", () => {
  // No facility upload and nothing tagged yet — the spend columns must not break.
  const bare = summarise([{ source: "LOCAL", supplier: "X", order_ym: "2026-03", terms_days: 60, amount_gbp: 100, status: "COMMITTED" }], []);
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

test("summarise: a facility drawing with nothing committed still breaches the budget", () => {
  const budgets = [{ source: "MINISO", ym: "2026-09", budget_gbp: 1000 }];
  const spend = { trade: tradeSpendByMonth([{ cost_driver: "Miniso LC's", due_date: "2026-09-30", facility_payment_gbp: 1500 }]) };
  const m = summarise([], budgets, spend).MINISO.months[0];
  // Nothing is committed, but £1,500 has been drawn on the facility against a
  // £1,000 budget — that is over on both measures, and variance says so.
  assert.equal(m.variance, -500);         // 1000 − 0 committed − 1500 trade pay
  assert.equal(m.overBudget, true);
  assert.equal(m.overSpent, true);
  assert.equal(m.spentVariance, -500);
});

test("KNOWN: a cash-settled order is netted off the budget twice", () => {
  // Not an accident — Finance chose budget − committed − trade pay − cash, and
  // cash spend is read from the same purchase rows that make up `committed`.
  // So a cash-settled order reduces headroom twice and the month reads tighter
  // than it is. This test exists to make that visible and findable rather than
  // to endorse it: if it starts to matter, make `committed` mean the OUTSTANDING
  // commitment so committed + spent is the total with nothing counted twice.
  const purchases = [{
    source: "LOCAL", supplier: "Korea Foods", order_ym: "2026-03", terms_days: 60,
    amount_gbp: 20000, status: "PAID", payment_method: "CASH", paid_date: "2026-09-10",
  }];
  const budgets = [{ source: "LOCAL", ym: "2026-09", budget_gbp: 50000 }];
  const m = summarise(purchases, budgets, { cash: cashSpendByMonth(purchases) }).LOCAL.months[0];
  assert.equal(m.committed, 20000);
  assert.equal(m.cashSpent, 20000);       // the same £20,000 order, counted again
  assert.equal(m.variance, 10000);        // 50,000 − 20,000 − 20,000, not 30,000
  assert.equal(m.overBudget, false);
});

test("no cash tagged means the overlap costs nothing", () => {
  // Why the above is safe to ship today: until Finance tag a paid invoice,
  // cashSpent is zero everywhere and the formula is exact.
  const purchases = [{
    source: "LOCAL", supplier: "Korea Foods", order_ym: "2026-03", terms_days: 60,
    amount_gbp: 20000, status: "COMMITTED",
  }];
  const budgets = [{ source: "LOCAL", ym: "2026-09", budget_gbp: 50000 }];
  const m = summarise(purchases, budgets, { cash: cashSpendByMonth(purchases) }).LOCAL.months[0];
  assert.equal(m.cashSpent, 0);
  assert.equal(m.variance, 30000);        // 50,000 − 20,000, nothing counted twice
});

// ---- Budget check shown while raising a request ----

const IMPACT_MONTHS = [
  { ym: "2026-09", committed: 40000, spent: 25000, budget: 60000 },
  { ym: "2026-10", committed: 90000, spent: 0, budget: 60000 },   // already over
  { ym: "2026-11", committed: 5000, spent: 0, budget: null },     // no budget set
];

test("budgetImpact: spend already out of the month counts against headroom", () => {
  // THE FAULT THIS PINS: spend was read, shown on screen, and then left out of
  // the arithmetic. Sep has £40k committed and £25k already drawn against a £60k
  // budget — it is £5k over before anyone raises anything. The old code reported
  // £5k of headroom and waved through another £15k. The budget is a cash-out
  // plan, so a facility drawing against it is spent whatever caused it.
  const i = budgetImpact(IMPACT_MONTHS, "2026-09", 15000);
  assert.equal(i.ym, "2026-09");
  assert.equal(i.budget, 60000);
  assert.equal(i.committed, 40000);
  assert.equal(i.spent, 25000);
  assert.equal(i.used, 65000);
  assert.equal(i.headroomBefore, -5000);   // over before this request
  assert.equal(i.add, 15000);
  assert.equal(i.newCommitted, 80000);
  assert.equal(i.headroom, -20000);
  assert.equal(i.over, true);
  assert.equal(i.alreadyOver, true);
  assert.equal(i.noBudget, false);
});

test("budgetImpact: headroom left after the request, on a month with room", () => {
  const months = [{ ym: "2026-09", committed: 20000, spent: 10000, budget: 60000 }];
  const i = budgetImpact(months, "2026-09", 15000);
  assert.equal(i.used, 30000);
  assert.equal(i.headroomBefore, 30000);
  assert.equal(i.newCommitted, 45000);
  assert.equal(i.headroom, 15000);         // 60000 - 20000 - 10000 - 15000
  assert.equal(i.over, false);
  assert.equal(i.alreadyOver, false);
});

test("budgetImpact: this request is what tips the month over", () => {
  const months = [{ ym: "2026-09", committed: 20000, spent: 10000, budget: 60000 }];
  const i = budgetImpact(months, "2026-09", 40000);
  assert.equal(i.headroomBefore, 30000);   // room before
  assert.equal(i.headroom, -10000);        // not after
  assert.equal(i.over, true);
  assert.equal(i.alreadyOver, false);      // this request is what did it
});

test("budgetImpact: the month was already over before this request", () => {
  const i = budgetImpact(IMPACT_MONTHS, "2026-10", 1000);
  assert.equal(i.over, true);
  assert.equal(i.alreadyOver, true);
  assert.equal(i.headroom, -31000);
});

test("budgetImpact: a month with no budget still reports, flagged", () => {
  const i = budgetImpact(IMPACT_MONTHS, "2026-11", 1000);
  assert.equal(i.noBudget, true);
  assert.equal(i.budget, null);
  assert.equal(i.headroom, null);
  assert.equal(i.over, false);
  assert.equal(i.newCommitted, 6000);   // still shows what it would commit
});

test("budgetImpact: a month with nothing in it yet, and not enough form to judge", () => {
  // Raising into a month that has no row at all — zero committed, no budget.
  const fresh = budgetImpact(IMPACT_MONTHS, "2027-06", 2000);
  assert.equal(fresh.committed, 0);
  assert.equal(fresh.spent, 0);
  assert.equal(fresh.newCommitted, 2000);
  assert.equal(fresh.noBudget, true);
  // No month worked out yet (form half-filled) → nothing to say.
  assert.equal(budgetImpact(IMPACT_MONTHS, null, 2000), null);
  assert.equal(budgetImpact(IMPACT_MONTHS, "", 2000), null);
  // A blank amount is a valid zero-impact read, not a crash.
  assert.equal(budgetImpact(IMPACT_MONTHS, "2026-09", "").newCommitted, 65000);
  assert.equal(budgetImpact(undefined, "2026-09", 100).committed, 0);
});

// ---- Finance control view: requests still to decide, vs budgets set ----

const PIPE_MONTHS = [
  { ym: "2026-09", committed: 50000, budget: 60000 },
  { ym: "2026-10", committed: 30000, budget: null },
];
// Both screens run a different lifecycle over the same table, so the predicate
// is the caller's — these mirror the two real ones.
const awaitingApproval = (o) => o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED";
const awaitingFinance = (r) => r.finance_status === "PENDING" || r.finance_status === "CHALLENGED";

test("requestsVsBudget: pending requests measured against the month's budget", () => {
  const rows = [
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 40000, approval_status: "APPROVED" },
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 15000, approval_status: "PENDING" },
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 9000, approval_status: "HOD_APPROVED" },
  ];
  const [m] = requestsVsBudget(rows, PIPE_MONTHS, awaitingApproval);
  assert.equal(m.ym, "2026-09");          // 31 Jul + 60d
  assert.equal(m.awaitingCount, 2);
  assert.equal(m.awaiting, 24000);
  assert.equal(m.committed, 40000);
  assert.equal(m.committedCount, 1);
  // The whole point: the two are exclusive and add up to would-commit.
  assert.equal(m.committed + m.awaiting, m.wouldCommit);
  assert.equal(m.wouldCommit, 64000);
  assert.equal(m.budget, 60000);
  assert.equal(m.headroom, 20000);          // 60k budget - 40k committed - 0 spent
  assert.equal(m.headroomIfApproved, -4000);
  assert.equal(m.over, false);              // not over on what is decided
  assert.equal(m.wouldGoOver, true);        // but approving the queue breaks it
});

test("requestsVsBudget: only months with something pending are returned", () => {
  const rows = [
    // Nothing pending here — settled only, so it is not a control problem.
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 40000, approval_status: "APPROVED" },
    // Pending, lands in a different month (31 Aug + 30d = Sep... use 0 terms).
    { source: "LOCAL", order_ym: "2026-04", terms_days: 0, amount_gbp: 5000, approval_status: "PENDING" },
  ];
  const out = requestsVsBudget(rows, PIPE_MONTHS, awaitingApproval);
  assert.deepEqual(out.map((m) => m.ym), ["2026-10"]);
  assert.equal(out[0].committed, 0);
  assert.equal(out[0].noBudget, true);     // 2026-10 has no budget set
  assert.equal(out[0].headroom, null);
  assert.equal(out[0].over, false);
});

test("requestsVsBudget: a month already over before the pending requests", () => {
  const rows = [
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 70000, approval_status: "APPROVED" },
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 1000, approval_status: "PENDING" },
  ];
  const [m] = requestsVsBudget(rows, PIPE_MONTHS, awaitingApproval);
  assert.equal(m.over, true);               // 70k approved against a 60k budget
  assert.equal(m.headroom, -10000);
  assert.equal(m.headroomIfApproved, -11000);
  assert.equal(m.wouldGoOver, false);       // already over, not "would go" over
});

test("requestsVsBudget: the finance lifecycle reads the same way", () => {
  const rows = [
    { source: "MINISO", order_ym: "2026-07", terms_days: 60, amount_gbp: 20000, finance_status: "CLOSED" },
    { source: "MINISO", order_ym: "2026-07", terms_days: 60, amount_gbp: 10000, finance_status: "CHALLENGED" },
    { source: "MINISO", order_ym: "2026-07", terms_days: 60, amount_gbp: 5000, finance_status: "PENDING" },
  ];
  const [m] = requestsVsBudget(rows, PIPE_MONTHS, awaitingFinance);
  assert.equal(m.awaitingCount, 2);        // challenged + pending
  assert.equal(m.awaiting, 15000);
  assert.equal(m.committed, 20000);        // closed
  assert.equal(m.wouldCommit, 35000);
  assert.equal(m.over, false);             // within the 60k
  assert.equal(m.headroom, 40000);         // 60k - 20k committed
  assert.equal(m.headroomIfApproved, 25000);
});

test("requestsVsBudget: rows with no month to land in are skipped, empty input is safe", () => {
  const rows = [
    // A merch request carries no order month — nothing to bucket it by.
    { source: "LOCAL", channel_code: "RETAIL", amount_gbp: 9999, approval_status: "PENDING" },
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 1000, approval_status: "PENDING" },
  ];
  const out = requestsVsBudget(rows, PIPE_MONTHS, awaitingApproval);
  assert.deepEqual(out.map((m) => m.ym), ["2026-09"]);
  assert.equal(out[0].awaiting, 1000);
  assert.deepEqual(requestsVsBudget(), []);
  assert.deepEqual(requestsVsBudget([], []), []);
});

// ---- Budget forecast import (month grid) ----

test("parseMonthHeader reads the month forms a spreadsheet actually exports", () => {
  assert.equal(parseMonthHeader("Sep-26"), "2026-09");
  assert.equal(parseMonthHeader("sep 26"), "2026-09");
  assert.equal(parseMonthHeader("Sept-26"), "2026-09");
  assert.equal(parseMonthHeader("September 2026"), "2026-09");
  assert.equal(parseMonthHeader("2026-09"), "2026-09");
  assert.equal(parseMonthHeader("2026-9"), "2026-09");
  assert.equal(parseMonthHeader("2026/09/01"), "2026-09");
  assert.equal(parseMonthHeader("09/2026"), "2026-09");
  assert.equal(parseMonthHeader("01/09/2026"), "2026-09");   // UK order: day first
  assert.equal(parseMonthHeader("Dec-28"), "2028-12");
  // Not months — the label column, a total, junk.
  assert.equal(parseMonthHeader("Source"), null);
  assert.equal(parseMonthHeader("Total"), null);
  assert.equal(parseMonthHeader(""), null);
  assert.equal(parseMonthHeader("2026-13"), null);           // no 13th month
  assert.equal(parseMonthHeader("Smurf-26"), null);
});

test("parseBudgetSource matches the row label on the phrase", () => {
  assert.equal(parseBudgetSource("Miniso"), "MINISO");
  assert.equal(parseBudgetSource("MINISO HQ"), "MINISO");
  assert.equal(parseBudgetSource("Local"), "LOCAL");
  assert.equal(parseBudgetSource("Local Purchase"), "LOCAL");
  assert.equal(parseBudgetSource("LP"), "LOCAL");
  assert.equal(parseBudgetSource("Total"), null);
  assert.equal(parseBudgetSource(""), null);
});

test("parseBudgetGridCsv reads a months-across grid into per-month budgets", () => {
  const csv = [
    "Source,Sep-26,Oct-26,Nov-26",
    "Miniso,180000,210000,195000",
    "Local,60000,55000,62000",
  ].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 6);
  assert.deepEqual(records.find((r) => r.source === "MINISO" && r.ym === "2026-10"), { source: "MINISO", ym: "2026-10", budget_gbp: 210000 });
  assert.deepEqual(records.find((r) => r.source === "LOCAL" && r.ym === "2026-11"), { source: "LOCAL", ym: "2026-11", budget_gbp: 62000 });
});

test("parseBudgetGridCsv: blank cells are skipped, not written as zero", () => {
  // A gap means "not budgeted" — writing 0 would wipe a month Finance had set.
  const csv = ["Source,Sep-26,Oct-26", "Miniso,180000,", "Local,,55000"].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 2);
  assert.ok(records.some((r) => r.source === "MINISO" && r.ym === "2026-09"));
  assert.ok(records.some((r) => r.source === "LOCAL" && r.ym === "2026-10"));
  assert.ok(!records.some((r) => r.ym === "2026-10" && r.source === "MINISO"));
});

test("parseBudgetGridCsv tolerates currency, separators and stray columns", () => {
  const csv = [
    "Source,Notes,Sep-26,Oct-26,Total",
    'Miniso,core range,"£180,000","210,000",390000',
    "Local,,£60000,55000,115000",
  ].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.deepEqual(errors, []);
  // "Notes" and "Total" are not months, so they are ignored entirely.
  assert.equal(records.length, 4);
  assert.equal(records.find((r) => r.source === "MINISO" && r.ym === "2026-09").budget_gbp, 180000);
  assert.equal(records.find((r) => r.source === "LOCAL" && r.ym === "2026-09").budget_gbp, 60000);
});

test("parseBudgetGridCsv reports what it could not read rather than dropping it", () => {
  // No month columns at all.
  const noMonths = parseBudgetGridCsv("Source,Notes\nMiniso,x");
  assert.equal(noMonths.records.length, 0);
  assert.match(noMonths.errors[0].reason, /No month columns/);
  // A Total row is what every real export carries — skipped silently, not flagged.
  const withTotal = parseBudgetGridCsv(["Source,Sep-26", "Miniso,180000", "Local,60000", "Total,240000"].join("\n"));
  assert.deepEqual(withTotal.errors, []);
  assert.equal(withTotal.records.length, 2);
  assert.equal(parseBudgetGridCsv("Source,Sep-26\nMiniso,1\nGrand Total,1").errors.length, 0);
  // An unrecognisable row label, and an unreadable amount.
  const csv = ["Source,Sep-26", "Miniso,180000", "Capex,50000", "Local,abc"].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.equal(records.length, 1);
  assert.ok(errors.some((e) => /Miniso or Local/.test(e.reason)));
  assert.ok(errors.some((e) => /Unreadable amount/.test(e.reason)));
  // A negative budget is refused rather than stored.
  const neg = parseBudgetGridCsv("Source,Sep-26\nMiniso,-5000");
  assert.equal(neg.records.length, 0);
  assert.ok(neg.errors.some((e) => /Negative budget/.test(e.reason)));
  // An empty file.
  assert.match(parseBudgetGridCsv("").errors[0].reason, /empty/);
});

test("parseBudgetGridCsv flags a duplicated month column and conflicting rows", () => {
  const dupCol = parseBudgetGridCsv("Source,Sep-26,Sep-26\nMiniso,1,2");
  assert.ok(dupCol.errors.some((e) => /more than once/.test(e.reason)));
  const dupRow = parseBudgetGridCsv("Source,Sep-26\nMiniso,100\nMiniso HQ,200");
  assert.ok(dupRow.errors.some((e) => /Two different budgets/.test(e.reason)));
});

test("the budget template parses cleanly through the importer", () => {
  const { records, errors } = parseBudgetGridCsv(BUDGET_CSV_TEMPLATE);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 8);
  assert.deepEqual([...new Set(records.map((r) => r.source))].sort(), ["LOCAL", "MINISO"]);
});

// ---- Finding the header row (a real export rarely starts with it) ----

test("parseBudgetGridCsv finds the header row under a title and blank lines", () => {
  const csv = [
    "Procurement Budget Forecast 2026-2028",   // title line
    "",                                         // spacer
    "Prepared by Finance,,,",                   // a note row
    "Source,Sep-26,Oct-26",
    "Miniso,180000,210000",
    "Local,60000,55000",
  ].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 4);
  assert.equal(records.find((r) => r.source === "MINISO" && r.ym === "2026-10").budget_gbp, 210000);
});

test("findMonthHeaderRow picks the row with the months, not the first row", () => {
  assert.equal(findMonthHeaderRow([["Title"], ["Source", "Sep-26", "Oct-26"], ["Miniso", "1", "2"]]), 1);
  assert.equal(findMonthHeaderRow([["Source", "Sep-26"], ["Miniso", "1"]]), 0);
  // Nothing month-like anywhere.
  assert.equal(findMonthHeaderRow([["Source", "Notes"], ["Miniso", "x"]]), -1);
  assert.equal(findMonthHeaderRow([]), -1);
});

test("row numbers in errors still point at the real line in the file", () => {
  const csv = [
    "Budget forecast",      // line 1
    "Source,Sep-26",        // line 2 — header
    "Miniso,180000",        // line 3
    "Capex,50000",          // line 4 — unrecognised label
  ].join("\n");
  const { records, errors } = parseBudgetGridCsv(csv);
  assert.equal(records.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 4);
});

test("a repeated month column is reported, not silently overwritten", () => {
  // Positional parsing keeps the two columns distinct; keying by header text
  // would have collapsed them and let the second quietly win.
  const { records, errors } = parseBudgetGridCsv("Source,Sep-26,Sep-26\nMiniso,100,999");
  assert.ok(errors.some((e) => /more than once/.test(e.reason)));
  assert.ok(errors.some((e) => /Two different budgets/.test(e.reason)));
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.budget_gbp), [100, 999]);
});

// ---- The control view surfaces over-budget months, not just queued ones ----

const OVER_MONTHS = [
  { ym: "2026-09", committed: 50000, spent: 0, budget: 60000, overBudget: false, overSpent: false },
  { ym: "2026-10", committed: 90000, spent: 0, budget: 60000, overBudget: true, overSpent: false },
  { ym: "2026-11", committed: 10000, spent: 80000, budget: 60000, overBudget: false, overSpent: true },
  { ym: "2026-12", committed: 5000, spent: 0, budget: 60000, overBudget: false, overSpent: false },
];

test("requestsVsBudget lists an over-budget month even with nothing queued", () => {
  // Only 2026-09 has a pending request, but Finance still have to explain Oct
  // (over on commitment) and Nov (overspent).
  const rows = [{ source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 1000, approval_status: "PENDING" }];
  const out = requestsVsBudget(rows, OVER_MONTHS, awaitingApproval);
  assert.deepEqual(out.map((m) => m.ym), ["2026-09", "2026-10", "2026-11"]);
  // A quiet, within-budget month stays out.
  assert.ok(!out.some((m) => m.ym === "2026-12"));
  // Oct and Nov are listed because the BUDGET TABLE flags them, but their
  // committed figure now comes from the rows passed in — none here — so it
  // reads zero rather than borrowing a number computed on a different basis.
  const oct = out.find((m) => m.ym === "2026-10");
  assert.equal(oct.awaitingCount, 0);
  assert.equal(oct.committed, 0);
  assert.equal(out.find((m) => m.ym === "2026-11").spent, 80000);
});

test("requestsVsBudget with { all } shows the whole horizon", () => {
  const out = requestsVsBudget([], OVER_MONTHS, awaitingApproval, { all: true });
  assert.deepEqual(out.map((m) => m.ym), ["2026-09", "2026-10", "2026-11", "2026-12"]);
  // Exceptions-only is still the default.
  assert.equal(requestsVsBudget([], OVER_MONTHS, awaitingApproval).length, 2);
});

test("requestsVsBudget takes spend from the budget table and commitment from the rows", () => {
  // Spend is settlement — the facility upload and cash — so it can only come
  // from the budget table. Commitment is the rows themselves, so that it and
  // `awaiting` partition the same population and actually add up.
  const rows = [{ source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 12000, approval_status: "APPROVED" }];
  const out = requestsVsBudget(rows, OVER_MONTHS, awaitingApproval, { all: true });
  const sep = out.find((m) => m.ym === "2026-09");
  assert.equal(sep.committed, 12000);      // from the row, not the table's 50000
  assert.equal(sep.spent, 0);
  assert.equal(out.find((m) => m.ym === "2026-11").spent, 80000);
  // A month with no row in the budget table reads zero rather than undefined.
  const bare = requestsVsBudget(
    // Ordered Jul 2026 → 31 Jul + 180d = Jan 2027, outside OVER_MONTHS.
    [{ source: "LOCAL", order_ym: "2026-07", terms_days: 0, amount_gbp: 500, approval_status: "PENDING" }],
    OVER_MONTHS, awaitingApproval);
  const jan = bare.find((m) => m.ym === "2027-01");
  assert.equal(jan.committed, 0);
  assert.equal(jan.spent, 0);
  assert.equal(jan.noBudget, true);
});

test("requestsVsBudget: spent counts against headroom alongside committed", () => {
  // The agreed variance is budget - committed - trade pay - cash. A month whose
  // budget is eaten by settlement is over even with a small order book.
  const months = [{ ym: "2026-09", committed: 0, spent: 55000, budget: 60000 }];
  const rows = [
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 8000, approval_status: "APPROVED" },
    { source: "LOCAL", order_ym: "2026-03", terms_days: 60, amount_gbp: 2000, approval_status: "PENDING" },
  ];
  const [m] = requestsVsBudget(rows, months, awaitingApproval);
  assert.equal(m.spent, 55000);
  assert.equal(m.headroom, -3000);           // 60000 - 8000 - 55000
  assert.equal(m.headroomIfApproved, -5000);
  assert.equal(m.over, true);
  assert.equal(m.wouldGoOver, false);        // already over, so not "would go"
});


test("tradeSpendByMonth counts both Miniso routes, and still not Miniso Investment", () => {
  const spend = tradeSpendByMonth([
    { cost_driver: "Miniso LC", due_date: "2026-10-13", facility_payment_gbp: 218309 },
    { cost_driver: "Miniso Facility", due_date: "2026-10-21", facility_payment_gbp: 168341 },
    { cost_driver: "Miniso Investment", due_date: "2026-10-21", facility_payment_gbp: 95654 }, // not procurement
    { cost_driver: "Local Purchase", due_date: "2026-10-07", facility_payment_gbp: 117398 },
    { cost_driver: "Opex", due_date: "2026-10-21", facility_payment_gbp: 110027 },
    { cost_driver: "Capex", due_date: "2026-10-21", facility_payment_gbp: 32343 },
  ]);
  assert.equal(spend.MINISO["2026-10"], 218309 + 168341);   // both routes, no Investment
  assert.equal(spend.LOCAL["2026-10"], 117398);
});

// ---- Valuing a drawing when the extract carries no GBP figure ----

test("facilityGbp: the bank's GBP figure wins when present", () => {
  assert.equal(facilityGbp({ facility_payment_gbp: 142567.29, payment_amount: 191040.18, payment_currency: "USD" }), 142567.29);
});

test("facilityGbp: a GBP drawing falls back to its payment amount", () => {
  assert.equal(facilityGbp({ payment_amount: 13899.3, payment_currency: "GBP" }), 13899.3);
  assert.equal(facilityGbp({ payment_amount: 13899.3 }), 13899.3);            // currency blank = GBP
  assert.equal(facilityGbp({ facility_payment_gbp: null, payment_amount: 100, payment_currency: "gbp" }), 100);
});

test("facilityGbp: a foreign drawing converts at spot, or reports null", () => {
  const rateFor = (c) => (c === "USD" ? 1.34 : null);
  assert.equal(Math.round(facilityGbp({ payment_amount: 191040.18, payment_currency: "USD" }, rateFor)), 142567);
  // No rate for that currency, or no resolver at all — don't guess a value.
  assert.equal(facilityGbp({ payment_amount: 1000, payment_currency: "EUR" }, rateFor), null);
  assert.equal(facilityGbp({ payment_amount: 1000, payment_currency: "USD" }), null);
  // Nothing to value at all.
  assert.equal(facilityGbp({}), null);
  assert.equal(facilityGbp({ payment_amount: 0, payment_currency: "GBP" }), null);
});

test("tradeSpendByMonth values from payment_amount and counts what it cannot price", () => {
  const rateFor = (c) => (c === "USD" ? 1.34 : null);
  const spend = tradeSpendByMonth([
    // No GBP figure — valued from the payment amount at spot.
    { cost_driver: "Miniso Facility", due_date: "2026-10-21", payment_amount: 134000, payment_currency: "USD" },
    // GBP drawing, no conversion needed.
    { cost_driver: "Local Purchase", due_date: "2026-10-07", payment_amount: 117398, payment_currency: "GBP" },
    // Foreign with no rate — cannot be priced, so counted rather than silently zero.
    { cost_driver: "Miniso LC", due_date: "2026-10-13", payment_amount: 5000, payment_currency: "EUR" },
  ], rateFor);
  assert.equal(spend.MINISO["2026-10"], 100000);
  assert.equal(spend.LOCAL["2026-10"], 117398);
  assert.deepEqual(spend.unvalued, { MINISO: 1, LOCAL: 0 });
});

test("summarise carries the unpriced count through to the source summary", () => {
  const trade = tradeSpendByMonth([
    { cost_driver: "Local Purchase", due_date: "2026-09-30", payment_amount: 500, payment_currency: "USD" },
  ]);   // no rateFor at all
  const s = summarise([], [], { trade });
  assert.equal(s.LOCAL.unvaluedDrawings, 1);
  assert.equal(s.LOCAL.totalTradeSpent, 0);
  assert.equal(s.MINISO.unvaluedDrawings, 0);
});

// ---- Local settles on the 180-day trade facility ----

test("Local cash-out is always the 180-day mark, whatever the supplier terms", () => {
  assert.equal(LOCAL_FACILITY_DAYS, 180);
  // 31 Jul 2026 + 180d = 27 Jan 2027, for every set of terms.
  for (const terms of [0, 14, 30, 60, 90, 120]) {
    assert.equal(cashOutFor({ source: "LOCAL", order_ym: "2026-07", terms_days: terms }), "2027-01",
      `terms of ${terms} days should not move the cash-out month`);
  }
  // Miniso is unchanged: pickup + 180.
  assert.equal(cashOutFor({ source: "MINISO", pickup_date: "2026-07-15", order_ym: "2026-07" }), "2027-01");
  // A legacy row with no source still uses its own terms.
  assert.equal(cashOutFor({ order_ym: "2026-07", terms_days: 30 }), "2026-08");
});

test("tradeFacilitySplit shows how the 180 days divides", () => {
  const s = tradeFacilitySplit(30);
  assert.equal(s.total, 180);
  assert.equal(s.supplierDays, 30);     // supplier paid from the drawdown
  assert.equal(s.facilityDays, 150);    // facility carries the rest
  assert.equal(s.over, false);
  assert.equal(tradeFacilitySplit(0).facilityDays, 180);    // nothing on terms — facility carries it all
  assert.equal(tradeFacilitySplit(180).facilityDays, 0);    // terms consume the whole facility term
});

test("tradeFacilitySplit flags terms beyond the facility term rather than clamping", () => {
  // Being paid at 210 days when we repay HSBC at 180 is a real problem, not a
  // rounding case — report it instead of quietly showing zero.
  const over = tradeFacilitySplit(210);
  assert.equal(over.facilityDays, -30);
  assert.equal(over.over, true);
  // Nothing entered yet is nothing to split — NOT "0 days, facility carries all
  // 180", which is what Number(null) and Number("") would otherwise produce.
  assert.equal(tradeFacilitySplit(null), null);
  assert.equal(tradeFacilitySplit(undefined), null);
  assert.equal(tradeFacilitySplit(""), null);
  assert.equal(tradeFacilitySplit(-1), null);
  assert.equal(tradeFacilitySplit("abc"), null);
  // But an explicit zero is a real answer: no terms, facility carries all of it.
  assert.equal(tradeFacilitySplit(0).facilityDays, 180);
});

// ---- Re-phasing a budget forecast ----
import { shiftBudgetPlan, budgetShiftError, ymShift, ymDiff, MAX_BUDGET_SHIFT } from "../lib/procurement-rules.js";

test("ymShift and ymDiff cross year boundaries both ways", () => {
  assert.equal(ymShift("2026-10", 6), "2027-04");
  assert.equal(ymShift("2027-04", -6), "2026-10");
  assert.equal(ymShift("2026-12", 1), "2027-01");
  assert.equal(ymShift("2026-01", -1), "2025-12");
  assert.equal(ymShift("2026-07", 0), "2026-07");
  assert.equal(ymShift("", 6), null);
  assert.equal(ymShift("nonsense", 6), null);
  assert.equal(ymDiff("2026-07", "2027-01"), 6);
  assert.equal(ymDiff("2027-01", "2026-07"), -6);
  assert.equal(ymDiff("2026-07", "2026-07"), 0);
  assert.equal(ymDiff("2026-07", ""), null);
});

test("budgetShiftError refuses what would silently do nothing or run away", () => {
  assert.equal(budgetShiftError(6), null);
  assert.equal(budgetShiftError(-6), null);
  assert.match(budgetShiftError(0), /zero/);
  assert.match(budgetShiftError(1.5), /whole number/);
  assert.match(budgetShiftError("abc"), /whole number/);
  assert.match(budgetShiftError(MAX_BUDGET_SHIFT + 1), /within 36/);
  assert.equal(budgetShiftError(MAX_BUDGET_SHIFT), null);
});

test("shiftBudgetPlan moves every budget and leaves the figures alone", () => {
  const months = [
    { ym: "2026-07", budget: 700000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-08", budget: 800000, committed: 0, tradeSpent: 0, cashSpent: 0 },
  ];
  const p = shiftBudgetPlan(months, 6);
  assert.equal(p.moved, 2);
  assert.equal(p.total, 1500000);
  assert.equal(p.from, "2026-07");
  assert.equal(p.shiftedFrom, "2027-01");
  assert.equal(p.shiftedTo, "2027-02");
  const jan = p.rows.find((r) => r.ym === "2027-01");
  assert.equal(jan.budgetAfter, 700000);
  assert.equal(jan.budgetNow, null);
  const jul = p.rows.find((r) => r.ym === "2026-07");
  assert.equal(jul.budgetNow, 700000);
  assert.equal(jul.budgetAfter, null);
});

test("shiftBudgetPlan names the months a shift would strand", () => {
  // The exact case that stopped the blanket +6: budget starts Jul 2026, but the
  // facility drawings fall due from Oct 2026. Shifting +6 empties Oct–Dec while
  // real money is going out of them.
  const months = [
    { ym: "2026-07", budget: 700000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-08", budget: 700000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-09", budget: 800000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-10", budget: 1670000, committed: 0, tradeSpent: 218309, cashSpent: 0 },
    { ym: "2026-11", budget: 1130000, committed: 640000, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-12", budget: 1130000, committed: 640000, tradeSpent: 0, cashSpent: 0 },
  ];
  const six = shiftBudgetPlan(months, 6);
  assert.deepEqual(six.stranded.map((r) => r.ym), ["2026-10", "2026-11", "2026-12"]);
  assert.equal(six.strandedActivity, 218309 + 640000 + 640000);
  // Activity starts in October, budget in July — so the shift that lines them up
  // is +3, and the plan says so rather than leaving it to be worked out by hand.
  assert.equal(six.firstActivity, "2026-10");
  assert.equal(six.suggested, 3);

  // And at the suggested shift nothing is stranded.
  const three = shiftBudgetPlan(months, 3);
  assert.deepEqual(three.stranded, []);
  assert.equal(three.strandedActivity, 0);
  assert.equal(three.shiftedFrom, "2026-10");
});

test("shiftBudgetPlan counts commitment, trade pay and cash as activity alike", () => {
  // A month is covered or not on the total cash landing in it, whatever route it
  // took — otherwise a month settled entirely through the facility looks empty.
  const only = (field) => shiftBudgetPlan([
    { ym: "2026-07", budget: 500000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-09", budget: null, [field]: 250000 },
  ], 6);
  for (const f of ["committed", "tradeSpent", "cashSpent"]) {
    const p = only(f);
    assert.deepEqual(p.stranded.map((r) => r.ym), ["2026-09"], `${f} should count as activity`);
    assert.equal(p.strandedActivity, 250000);
  }
});

test("shiftBudgetPlan is lossless — shifting back restores the original months", () => {
  const months = [
    { ym: "2026-07", budget: 700000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2026-08", budget: 800000, committed: 0, tradeSpent: 0, cashSpent: 0 },
    { ym: "2027-01", budget: 250000, committed: 0, tradeSpent: 0, cashSpent: 0 },
  ];
  const fwd = shiftBudgetPlan(months, 6);
  // Feed the shifted result back in as the new "now" and shift the other way.
  const asNow = fwd.rows.filter((r) => r.budgetAfter != null)
    .map((r) => ({ ym: r.ym, budget: r.budgetAfter, committed: 0, tradeSpent: 0, cashSpent: 0 }));
  const back = shiftBudgetPlan(asNow, -6);
  const restored = back.rows.filter((r) => r.budgetAfter != null)
    .map((r) => ({ ym: r.ym, budget: r.budgetAfter }));
  assert.deepEqual(restored, months.map((m) => ({ ym: m.ym, budget: m.budget })));
  assert.equal(back.total, fwd.total);
});

test("shiftBudgetPlan with no budget set reports nothing to move", () => {
  const p = shiftBudgetPlan([{ ym: "2026-10", budget: null, committed: 500000 }], 6);
  assert.equal(p.moved, 0);
  assert.equal(p.total, 0);
  assert.equal(p.from, null);
  assert.equal(p.suggested, null);   // nothing to line up
  // The activity month is still listed, and still flagged as uncovered.
  assert.deepEqual(p.stranded.map((r) => r.ym), ["2026-10"]);
});

test("requestsVsBudget places a Miniso order by pickup date, as the budget table does", () => {
  // The close desk didn't select pickup_date, so cashOutFor fell back to order
  // month + terms and put the row in a DIFFERENT month than the budget table.
  // The two screens then showed the same order against two months, side by side,
  // and "would commit" tied to neither. Selecting pickup_date is the fix; this
  // pins the behaviour it restores.
  const months = [{ ym: "2027-03", committed: 0, spent: 0, budget: 600000 }];
  const withPickup = [{ source: "MINISO", order_ym: "2026-06", terms_days: 30, pickup_date: "2026-09-15", amount_gbp: 498422, finance_status: "CHALLENGED" }];
  const [m] = requestsVsBudget(withPickup, months, awaitingFinance, { all: true });
  assert.equal(m.ym, "2027-03");             // 15 Sep 2026 + 180d
  assert.equal(m.awaiting, 498422);

  // Without it, the same order lands in Jul 2026 — the bug, kept visible.
  const noPickup = [{ ...withPickup[0], pickup_date: undefined }];
  const out = requestsVsBudget(noPickup, months, awaitingFinance, { all: true });
  assert.ok(out.some((r) => r.ym === "2026-07" && r.awaiting === 498422));
});

// ---- Finance challenges reaching the team who raised the order ----
import { financeChallenge, challengedOrders } from "../lib/procurement-rules.js";

test("financeChallenge surfaces a challenge the approval lifecycle hides", () => {
  // THE FAULT THIS PINS: a challenge writes finance_status only. The raise page
  // reads approval_status, which still says APPROVED — so the order looked fine
  // to the only people who could resolve it.
  const o = {
    approval_status: "APPROVED", finance_status: "CHALLENGED",
    challenge_reasons: "SPEND_VS_BUDGET,SUPPLIER_TERMS",
    challenge_note: "Takes Mar 2027 over — can this move?",
    challenged_by: "kris@kouriten.com", challenged_at: "2026-09-23T09:00:00Z",
  };
  const c = financeChallenge(o);
  assert.deepEqual(c.reasons, ["SPEND_VS_BUDGET", "SUPPLIER_TERMS"]);
  assert.equal(c.note, "Takes Mar 2027 over — can this move?");
  assert.equal(c.by, "kris@kouriten.com");
});

test("financeChallenge returns null when there is nothing to answer", () => {
  assert.equal(financeChallenge({ approval_status: "APPROVED", finance_status: "APPROVED" }), null);
  assert.equal(financeChallenge({ approval_status: "APPROVED", finance_status: "CLOSED" }), null);
  assert.equal(financeChallenge({ approval_status: "PENDING" }), null);
  // Finance re-approving or closing after a challenge settles it.
  assert.equal(financeChallenge({ finance_status: "APPROVED", challenge_reasons: "LANDED_COST" }), null);
  // A cancelled order is not a live question whatever Finance last recorded.
  assert.equal(financeChallenge({ approval_status: "CANCELLED", finance_status: "CHALLENGED" }), null);
  assert.equal(financeChallenge({}), null);
  assert.equal(financeChallenge(), null);
});

test("financeChallenge copes with either shape of challenge_reasons, and no note", () => {
  // Stored as a comma string; an array is accepted too rather than stringified.
  assert.deepEqual(financeChallenge({ finance_status: "CHALLENGED", challenge_reasons: "OTHER" }).reasons, ["OTHER"]);
  assert.deepEqual(financeChallenge({ finance_status: "CHALLENGED", challenge_reasons: ["OTHER", "INVOICE_VALUE"] }).reasons, ["OTHER", "INVOICE_VALUE"]);
  // Blank / absent reasons must not become [""] — the UI would render an empty bullet.
  assert.deepEqual(financeChallenge({ finance_status: "CHALLENGED", challenge_reasons: "" }).reasons, []);
  assert.deepEqual(financeChallenge({ finance_status: "CHALLENGED" }).reasons, []);
  // An empty or whitespace note reads as no note, not as an empty quotation.
  assert.equal(financeChallenge({ finance_status: "CHALLENGED", challenge_note: "   " }).note, null);
});

test("challengedOrders counts only what the raising team must act on", () => {
  const orders = [
    { purchase_id: 1, approval_status: "APPROVED", finance_status: "CHALLENGED", challenge_reasons: "LANDED_COST" },
    { purchase_id: 2, approval_status: "APPROVED", finance_status: "APPROVED" },
    { purchase_id: 3, approval_status: "CANCELLED", finance_status: "CHALLENGED" },
    { purchase_id: 4, approval_status: "PENDING", finance_status: "CHALLENGED", challenge_reasons: "OTHER" },
  ];
  assert.deepEqual(challengedOrders(orders).map((o) => o.purchase_id), [1, 4]);
  assert.deepEqual(challengedOrders([]), []);
  assert.deepEqual(challengedOrders(), []);
});

// ---- The LC balance is what stays committed ----

test("summarise nets the drawn LCs out of committed, so nothing is counted twice", () => {
  // THE FAULT THIS PINS. A Miniso request worth £515,625 with £501,638 already
  // drawn as LCs. Those drawings are on the trade facility, so the facility
  // upload reports them as SPENT. Counting the whole order as committed as well
  // charged the month twice for the same money — which is why every Miniso month
  // read over.
  const months = [{ source: "MINISO", ym: "2027-03", budget_gbp: 600000 }];
  const order = {
    source: "MINISO", supplier: "Miniso HQ", order_ym: "2026-09",
    pickup_date: "2026-09-18", amount_gbp: 496241,
    committed_gbp: 13987.5,                       // inventory 515,625 − drawn 501,637.50
  };
  const spend = { trade: { MINISO: { "2027-03": 501637.5 }, LOCAL: {} }, cash: { MINISO: {}, LOCAL: {} } };
  const out = summarise([order], months, spend);
  // 18 Sep 2026 + 180 days lands in March 2027 — the same month the facility
  // reports the drawings in, so the two halves of this order meet.
  const mar = out.MINISO.months.find((m) => m.ym === "2027-03");
  assert.equal(mar.committed, 13987.5);           // the balance, not the whole order
  assert.equal(out.MINISO.totalCommitted, 13987.5);
  // Committed + the facility's own spend now equals the order once, not twice.
  assert.equal(mar.committed + mar.tradeSpent, 515625);
  // And the month is no longer over: 600,000 budget against 515,625 of activity.
  assert.equal(mar.overBudget, false);
  assert.equal(mar.variance, 600000 - 13987.5 - 501637.5);
});

test("summarise falls back to the order value when no balance is supplied", () => {
  // A Local purchase, a Miniso request with no LCs drawn, or a foreign order
  // whose costing rate is missing — all keep the old behaviour exactly.
  const months = [{ source: "LOCAL", ym: "2026-09", budget_gbp: 100000 }];
  const local = { source: "LOCAL", supplier: "RMS", order_ym: "2026-03", terms_days: 30, amount_gbp: 40000 };
  const out = summarise([local], months, {});
  assert.equal(out.LOCAL.months.find((m) => m.ym === "2026-09").committed, 40000);
  assert.equal(out.LOCAL.totalCommitted, 40000);
});

test("summarise: a zero balance commits nothing, and is not mistaken for absent", () => {
  // Fully drawn — every pound is on the facility and reported as spent, so the
  // month carries no commitment at all. `committed_gbp: 0` must not fall through
  // to the order value, which is what `||` would have done.
  const order = { source: "MINISO", supplier: "Miniso HQ", order_ym: "2026-09", pickup_date: "2026-09-18", amount_gbp: 496241, committed_gbp: 0 };
  const out = summarise([order], [], {});
  assert.equal(out.MINISO.totalCommitted, 0);
  assert.equal(out.MINISO.months.find((m) => m.committed !== 0), undefined);
});

test("requestsVsBudget uses the same committed basis as summarise", () => {
  // THE FAULT THIS PINS. Committed is computed in TWO places: summarise() for
  // the budget tables, and requestsVsBudget() for the close desk panel. The
  // first was moved onto the LC balance and the second was not, so the close
  // desk went on showing every Miniso month over — counting the drawn part as
  // committed there while Treasury also reported it as spent.
  const months = [{ ym: "2026-11", committed: 0, spent: 385183, budget: 512676 }];
  // LC90: fully drawn, so nothing is still committed.
  const rows = [{
    source: "MINISO", order_ym: "2026-06", pickup_date: "2026-06-15",
    amount_gbp: 413534, committed_gbp: 0, finance_status: "APPROVED",
  }];
  const [m] = requestsVsBudget(rows, months, AWAITING_FIN, { all: true });
  assert.equal(m.ym, "2026-11");
  assert.equal(m.committed, 0);                  // the balance, not the £413,534 order
  assert.equal(m.wouldCommit, 0);
  // 512,676 budget − 0 committed − 385,183 spent. The month is no longer over.
  assert.equal(m.headroom, 127493);
  assert.equal(m.over, false);
});

const AWAITING_FIN = (r) => r.finance_status === "PENDING" || r.finance_status === "CHALLENGED";

test("requestsVsBudget still uses the order value when no balance is given", () => {
  // A Local purchase, or a Miniso order with nothing drawn — unchanged.
  const months = [{ ym: "2026-09", committed: 0, spent: 0, budget: 100000 }];
  const rows = [{ source: "LOCAL", order_ym: "2026-03", terms_days: 30, amount_gbp: 40000, finance_status: "APPROVED" }];
  const [m] = requestsVsBudget(rows, months, AWAITING_FIN, { all: true });
  assert.equal(m.committed, 40000);
});

// ---- What a month's spend is made of ----
import { facilityDriverOf } from "../lib/procurement-rules.js";

test("facilityDriverOf names the instrument, absorbing the extract's drift", () => {
  // The same instrument is typed several ways; it must report as one thing.
  assert.equal(facilityDriverOf({ cost_driver: "Miniso LC" }), "Miniso LC");
  assert.equal(facilityDriverOf({ cost_driver: "Miniso LC's" }), "Miniso LC");
  assert.equal(facilityDriverOf({ cost_driver: "  MINISO   LCs " }), "Miniso LC");
  assert.equal(facilityDriverOf({ cost_driver: "Miniso Facility" }), "Miniso Facility");
  assert.equal(facilityDriverOf({ cost_driver: "Miniso Facilities" }), "Miniso Facility");
  assert.equal(facilityDriverOf({ cost_driver: "Local Purchases" }), "Local Purchase");
  // Still not procurement, and still must not be counted.
  assert.equal(facilityDriverOf({ cost_driver: "Miniso Investment" }), null);
  assert.equal(facilityDriverOf({ cost_driver: "Opex" }), null);
  assert.equal(facilityDriverOf({}), null);
});

test("tradeSpendByMonth splits a month by instrument as well as totalling it", () => {
  // Oct 2026 as it stands: £1,276,559 of Miniso spend that turned out to be two
  // instruments, which one number could not show.
  const spend = tradeSpendByMonth([
    { cost_driver: "Miniso LC", due_date: "2026-10-13", facility_payment_gbp: 443000 },
    { cost_driver: "Miniso Facility", due_date: "2026-10-21", facility_payment_gbp: 833559 },
    { cost_driver: "Local Purchase", due_date: "2026-10-05", facility_payment_gbp: 117398 },
  ]);
  assert.equal(spend.MINISO["2026-10"], 1276559);
  assert.deepEqual(spend.byDriver.MINISO["2026-10"], { "Miniso LC": 443000, "Miniso Facility": 833559 });
  // The split always adds back to the total.
  const parts = Object.values(spend.byDriver.MINISO["2026-10"]).reduce((a, b) => a + b, 0);
  assert.equal(parts, spend.MINISO["2026-10"]);
  assert.deepEqual(spend.byDriver.LOCAL["2026-10"], { "Local Purchase": 117398 });
});

test("summarise carries the split onto the month, with cash alongside", () => {
  const spend = {
    trade: {
      MINISO: { "2027-03": 797072 }, LOCAL: {},
      byDriver: { MINISO: { "2027-03": { "Miniso LC": 500000, "Miniso Facility": 297072 } }, LOCAL: {} },
    },
    cash: { MINISO: { "2027-03": 12000 }, LOCAL: {} },
  };
  const order = { source: "MINISO", supplier: "Miniso HQ", order_ym: "2026-09", pickup_date: "2026-09-18", amount_gbp: 100 };
  const [m] = summarise([order], [], spend).MINISO.months.filter((x) => x.ym === "2027-03");
  assert.deepEqual(m.spentByDriver, { "Miniso LC": 500000, "Miniso Facility": 297072, Cash: 12000 });
  // Cash is spend ON TOP of the facility, so the parts still make the whole.
  assert.equal(Object.values(m.spentByDriver).reduce((a, b) => a + b, 0), m.spent);
});
