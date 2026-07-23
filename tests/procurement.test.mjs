import test from "node:test";
import assert from "node:assert/strict";
import { cashOutYm, summarise, parseProcurementCsv } from "../lib/procurement-rules.js";

test("cash-out month = order month-end + payment terms", () => {
  assert.equal(cashOutYm("2026-07", 60), "2026-09");   // 31 Jul + 60d = 29 Sep
  assert.equal(cashOutYm("2026-07", 30), "2026-08");   // 31 Jul + 30d = 30 Aug
  assert.equal(cashOutYm("2026-07", 0), "2026-07");    // due at month-end
  assert.equal(cashOutYm("2026-07", 14), "2026-08");   // 31 Jul + 14d = 14 Aug
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
