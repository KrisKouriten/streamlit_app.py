import test from "node:test";
import assert from "node:assert/strict";
import { mapProfitAndLoss, ACCOUNT_MAP } from "../lib/xero-rules.js";

// Real Kouriten Cambridge Limited H1 2026 P&L (subset, non-zero accounts).
const cambridgeH1 = {
  income: [{ name: "ST: Sales", balance: 329683.36 }],
  costOfSales: [
    { name: "ST: Cost of Goods Sold", balance: 127963.23 },
    { name: "ST: Distribution Costs", balance: 4685.49 },
  ],
  expenses: [
    { name: "ST: Salaries - Basic Pay", balance: 69846.28 },
    { name: "ST: Rent", balance: 60000.0 },
    { name: "ST: Rates", balance: 30886.62 },
    { name: "ST: Service Charges", balance: 19879.14 },
    { name: "ST: Utilities", balance: 12021.09 },
    { name: "ST: Salaries - Holiday Pay", balance: 10679.42 },
    { name: "ST: Employers National Insurance", balance: 6408.37 },
    { name: "ST: Merchant Charges", balance: 3536.45 },
    { name: "ST: Computer & IT Expenses", balance: 1909.35 },
    { name: "ST: Pensions Costs", balance: 1730.28 },
    { name: "ST: Audit & Accountancy fees", balance: 1245.76 },
    { name: "ST: Insurance", balance: 931.72 },
    { name: "ST: Telephone & Internet", balance: 777.34 },
    { name: "ST: Bank Charges", balance: 741.18 },
    { name: "ST: Recruitment costs", balance: 600.0 },
    { name: "ST: Subscriptions", balance: 493.7 },
    { name: "ST: Repairs & Maintenance", balance: 413.96 },
    { name: "ST: Printing & Stationery", balance: 353.84 },
    { name: "ST: Legal & Professional Fees", balance: 343.2 },
    { name: "ST: Cleaning", balance: 116.78 },
    { name: "ST: Mileage & Travelling", balance: 26.75 },
    { name: "ST: Advertising & Marketing", balance: 4.67 },
    { name: "Payment Fee", balance: 2.0 },
  ],
  totals: { income: 329683.36, costOfSales: 132648.72, expenses: 222947.9, netProfit: -25913.26 },
};

test("Cambridge H1 P&L reconciles to Xero's own section totals", () => {
  const { reconciliation } = mapProfitAndLoss(cambridgeH1);
  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.income, 329683.36);
  assert.equal(reconciliation.cogs, 132648.72);
  assert.equal(reconciliation.expenses, 222947.9);
  assert.equal(reconciliation.netProfit, -25913.26);
});

test("income is positive, cost and expense lines are negative", () => {
  const { lines } = mapProfitAndLoss(cambridgeH1);
  assert.equal(lines.find((l) => l.account_code === "4000").amount_gbp, 329683.36);
  assert.ok(lines.find((l) => l.account_code === "5000").amount_gbp < 0);
  for (const code of ["6000", "6100", "6200", "7000"]) {
    assert.ok(lines.find((l) => l.account_code === code).amount_gbp < 0, `${code} should be negative`);
  }
});

test("net result equals the sum of all mapped lines", () => {
  const { lines, reconciliation } = mapProfitAndLoss(cambridgeH1);
  const sum = Math.round(lines.reduce((s, l) => s + l.amount_gbp, 0) * 100) / 100;
  assert.equal(sum, reconciliation.netProfit);
});

test("expenses split into the four operating-cost buckets", () => {
  const { lines } = mapProfitAndLoss(cambridgeH1);
  assert.equal(lines.find((l) => l.account_code === "6000").amount_gbp, -89264.35); // labour
  assert.equal(lines.find((l) => l.account_code === "6100").amount_gbp, -123317.59); // occupancy
  assert.equal(lines.find((l) => l.account_code === "6200").amount_gbp, -8777.0); // other
  assert.equal(lines.find((l) => l.account_code === "7000").amount_gbp, -1588.96); // central
});

test("an unmapped expense falls to Central Overheads and is reported, never dropped", () => {
  const pnl = {
    income: [{ name: "ST: Sales", balance: 1000 }],
    costOfSales: [],
    expenses: [{ name: "ST: Some New Account 2027", balance: 250 }],
    totals: { income: 1000, costOfSales: 0, expenses: 250, netProfit: 750 },
  };
  const { lines, reconciliation, unmapped } = mapProfitAndLoss(pnl);
  assert.equal(reconciliation.ok, true); // still reconciles — nothing lost
  assert.equal(lines.find((l) => l.account_code === "7000").amount_gbp, -250);
  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].name, "ST: Some New Account 2027");
});

test("reconciliation flags a mismatch when totals don't add up", () => {
  const bad = { ...cambridgeH1, totals: { ...cambridgeH1.totals, income: 999999 } };
  assert.equal(mapProfitAndLoss(bad).reconciliation.ok, false);
});

test("ACCOUNT_MAP routes each section to the right Finance OS account", () => {
  assert.equal(ACCOUNT_MAP["ST: Sales"], "4000");
  assert.equal(ACCOUNT_MAP["ST: Cost of Goods Sold"], "5000");
  assert.equal(ACCOUNT_MAP["ST: Rent"], "6100");
});
