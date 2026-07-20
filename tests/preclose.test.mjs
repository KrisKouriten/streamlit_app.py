import test from "node:test";
import assert from "node:assert/strict";
import { runChecks, parseExpectationsCsv } from "../lib/preclose-rules.js";

const EXP = [
  { account_code: "4000", behaviour: "REVENUE", expected_every_period: true },
  { account_code: "5000", behaviour: "VARIABLE", pct_of_revenue: 0.40, tolerance_pct: 0.10, tolerance_abs: 500 },
  { account_code: "6100", behaviour: "FIXED", monthly_amount: 20000, tolerance_pct: 0.10, tolerance_abs: 500 },
  { account_code: "7000", behaviour: "FIXED", monthly_amount: 300, tolerance_pct: 0.10, tolerance_abs: 100 },
];
const A = (code, name, sign, amount) => ({ account_code: code, account_name: name, natural_sign: sign, amount });

test("clean period: everything within tolerance is assured, no exceptions", () => {
  const { exceptions, assured } = runChecks({
    actuals: [A("4000", "Revenue", 1, 100000), A("5000", "COGS", -1, -40100), A("6100", "Rent", -1, -19800), A("7000", "Central", -1, -290)],
    expectations: EXP, monthsCovered: 1,
  });
  assert.equal(exceptions.length, 0);
  assert.ok(assured >= 3);
});

test("check A: scheduled fixed cost with no posting flags an accrual", () => {
  const { exceptions } = runChecks({
    actuals: [A("4000", "Revenue", 1, 100000), A("5000", "COGS", -1, -40000), A("7000", "Central", -1, -300)],
    expectations: EXP, monthsCovered: 1,
  });
  const miss = exceptions.find((e) => e.check === "A" && e.account_code === "6100");
  assert.ok(miss, "missing 6100 should flag");
  assert.equal(miss.severity, "HIGH");
  assert.match(miss.hint, /accrual/i);
  assert.equal(miss.expected, 20000);
});

test("check A: posting with no expectation flags as unexpected nominal", () => {
  const { exceptions } = runChecks({
    actuals: [A("4000", "Revenue", 1, 100000), A("9999", "Mystery", -1, -5000),
      A("5000", "COGS", -1, -40000), A("6100", "Rent", -1, -20000), A("7000", "Central", -1, -300)],
    expectations: EXP, monthsCovered: 1,
  });
  const unexpected = exceptions.find((e) => e.check === "A" && e.account_code === "9999");
  assert.ok(unexpected);
  assert.match(unexpected.hint, /reference model/i);
});

test("check B: variable cost drifting from the revenue driver flags with gap", () => {
  const { exceptions } = runChecks({
    actuals: [A("4000", "Revenue", 1, 100000), A("5000", "COGS", -1, -52000),
      A("6100", "Rent", -1, -20000), A("7000", "Central", -1, -300)],
    expectations: EXP, monthsCovered: 1,
  });
  const drift = exceptions.find((e) => e.check === "B" && e.account_code === "5000");
  assert.ok(drift);
  assert.equal(drift.expected, 40000);
  assert.equal(drift.actual, 52000);
  assert.ok(drift.variancePct > 0.25);
});

test("check C: fixed cost under schedule hints an accrual top-up; monthsCovered scales", () => {
  const { exceptions } = runChecks({
    actuals: [A("4000", "Revenue", 1, 600000), A("5000", "COGS", -1, -240000),
      A("6100", "Rent", -1, -90000), A("7000", "Central", -1, -1800)],
    expectations: EXP, monthsCovered: 6,
  });
  const fixed = exceptions.find((e) => e.check === "C" && e.account_code === "6100");
  assert.ok(fixed, "90k vs 120k (6 x 20k) should flag");
  assert.equal(fixed.expected, 120000);
  assert.match(fixed.hint, /accrual|missing|timing/i);
  // 7000 at 1800 = 6 x 300 exactly → assured, not flagged
  assert.ok(!exceptions.find((e) => e.account_code === "7000"));
});

test("sign check: a cost account in credit flags high", () => {
  const { exceptions } = runChecks({
    actuals: [A("4000", "Revenue", 1, 100000), A("5000", "COGS", -1, 40000),
      A("6100", "Rent", -1, -20000), A("7000", "Central", -1, -300)],
    expectations: EXP, monthsCovered: 1,
  });
  const sign = exceptions.find((e) => e.check === "SIGN" && e.account_code === "5000");
  assert.ok(sign);
  assert.equal(sign.severity, "HIGH");
});

test("expectations CSV maps behaviours, %s and validation errors", () => {
  const csv = [
    "Account Code,Behaviour,Monthly Amount,% of Revenue,Tolerance %,Tolerance £,Expected Every Period",
    "6100,FIXED,\"20,500\",,10,500,Yes",
    "5000,VARIABLE,,40,5,1000,Yes",
    "6100X,FIXED,,,,,Yes",
    ",VARIABLE,,40,,,Yes",
  ].join("\n");
  const { records, errors } = parseExpectationsCsv(csv);
  assert.equal(records.length, 2);
  assert.equal(records[0].monthly_amount, 20500);
  assert.equal(records[0].tolerance_pct, 0.10);
  assert.equal(records[1].pct_of_revenue, 0.40);
  assert.equal(errors.length, 2);
});
