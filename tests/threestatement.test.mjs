import test from "node:test";
import assert from "node:assert/strict";
import { classifyBsLine, balanceCheck, bsMovements, indirectCashFlow, SIDE, CATEGORY } from "../lib/threestatement-rules.js";

test("classifyBsLine buckets a standard chart of accounts", () => {
  assert.deepEqual(classifyBsLine("Current Assets", "Cash at bank"), { side: SIDE.ASSET, category: CATEGORY.CASH });
  assert.deepEqual(classifyBsLine("Current Assets", "Trade debtors"), { side: SIDE.ASSET, category: CATEGORY.OPERATING });
  assert.deepEqual(classifyBsLine("Fixed Assets", "Equipment"), { side: SIDE.ASSET, category: CATEGORY.INVESTING });
  assert.deepEqual(classifyBsLine("Current Liabilities", "Trade creditors"), { side: SIDE.LIABILITY, category: CATEGORY.OPERATING });
  assert.deepEqual(classifyBsLine("Long Term Liabilities", "Bank loan"), { side: SIDE.LIABILITY, category: CATEGORY.FINANCING });
  assert.deepEqual(classifyBsLine("Equity", "Share capital"), { side: SIDE.EQUITY, category: CATEGORY.FINANCING });
  assert.deepEqual(classifyBsLine("Equity", "Retained earnings"), { side: SIDE.EQUITY, category: CATEGORY.FINANCING });
});

const OPENING = [
  { section: "Current Assets", account: "Cash at bank", value: 100 },
  { section: "Current Assets", account: "Trade debtors", value: 50 },
  { section: "Fixed Assets", account: "Equipment", value: 200 },
  { section: "Current Liabilities", account: "Trade creditors", value: 40 },
  { section: "Long Term Liabilities", account: "Bank loan", value: 120 },
  { section: "Equity", account: "Share capital", value: 100 },
  { section: "Equity", account: "Retained earnings", value: 90 },
];

test("balanceCheck confirms Assets = Liabilities + Equity", () => {
  const bc = balanceCheck(OPENING);
  assert.equal(bc.assets, 350);
  assert.equal(bc.liabilities, 160);
  assert.equal(bc.equity, 190);
  assert.equal(bc.balances, true);
  assert.equal(bc.diff, 0);
});

test("indirect cash flow reconciles to the actual cash movement (no dividends)", () => {
  // net profit 30 flows to retained earnings; debtors +20, creditors +10,
  // equipment +15, loan repaid 20. Cash closes at 85 (opening 100).
  const closing = [
    { section: "Current Assets", account: "Cash at bank", value: 85 },
    { section: "Current Assets", account: "Trade debtors", value: 70 },
    { section: "Fixed Assets", account: "Equipment", value: 215 },
    { section: "Current Liabilities", account: "Trade creditors", value: 50 },
    { section: "Long Term Liabilities", account: "Bank loan", value: 100 },
    { section: "Equity", account: "Share capital", value: 100 },
    { section: "Equity", account: "Retained earnings", value: 120 },
  ];
  assert.equal(balanceCheck(closing).balances, true);
  const cf = indirectCashFlow({ netProfit: 30, opening: OPENING, closing });
  assert.equal(cf.operating.total, 20); // 30 − 20 debtors + 10 creditors
  assert.equal(cf.investing.total, -15); // equipment
  assert.equal(cf.financing.total, -20); // loan repaid; no equity ex-profit movement
  assert.equal(cf.financing.otherEquityMovement, 0);
  assert.equal(cf.openingCash, 100);
  assert.equal(cf.closingCash, 85);
  assert.equal(cf.actualMovement, -15);
  assert.equal(cf.netMovement, -15);
  assert.equal(cf.residual, 0);
  assert.equal(cf.reconciles, true);
});

test("dividends land in financing via otherEquityMovement and still reconcile", () => {
  // Same as above but £10 dividend: retained closes at 110, cash at 75.
  const closing = [
    { section: "Current Assets", account: "Cash at bank", value: 75 },
    { section: "Current Assets", account: "Trade debtors", value: 70 },
    { section: "Fixed Assets", account: "Equipment", value: 215 },
    { section: "Current Liabilities", account: "Trade creditors", value: 50 },
    { section: "Long Term Liabilities", account: "Bank loan", value: 100 },
    { section: "Equity", account: "Share capital", value: 100 },
    { section: "Equity", account: "Retained earnings", value: 110 },
  ];
  assert.equal(balanceCheck(closing).balances, true);
  const cf = indirectCashFlow({ netProfit: 30, opening: OPENING, closing });
  assert.equal(cf.financing.otherEquityMovement, -10); // the dividend
  assert.equal(cf.actualMovement, -25);
  assert.equal(cf.residual, 0);
  assert.equal(cf.reconciles, true);
});

test("a balance sheet that does not balance surfaces a non-zero residual", () => {
  const closing = [
    { section: "Current Assets", account: "Cash at bank", value: 90 }, // deliberately off
    { section: "Current Assets", account: "Trade debtors", value: 70 },
    { section: "Fixed Assets", account: "Equipment", value: 215 },
    { section: "Current Liabilities", account: "Trade creditors", value: 50 },
    { section: "Long Term Liabilities", account: "Bank loan", value: 100 },
    { section: "Equity", account: "Share capital", value: 100 },
    { section: "Equity", account: "Retained earnings", value: 120 },
  ];
  const cf = indirectCashFlow({ netProfit: 30, opening: OPENING, closing });
  assert.notEqual(cf.residual, 0);
  assert.equal(cf.reconciles, false);
});

test("bsMovements signs: asset increase consumes cash, liability increase releases it", () => {
  const closing = [
    { section: "Current Assets", account: "Trade debtors", value: 70 }, // +20 asset
    { section: "Current Liabilities", account: "Trade creditors", value: 55 }, // +15 liab
  ];
  const opening = [
    { section: "Current Assets", account: "Trade debtors", value: 50 },
    { section: "Current Liabilities", account: "Trade creditors", value: 40 },
  ];
  const moves = bsMovements(opening, closing);
  const deb = moves.find((m) => m.account === "Trade debtors");
  const cred = moves.find((m) => m.account === "Trade creditors");
  assert.equal(deb.cashImpact, -20);
  assert.equal(cred.cashImpact, 15);
});
