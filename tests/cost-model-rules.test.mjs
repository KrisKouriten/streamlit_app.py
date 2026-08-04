import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { classifyBehaviour, normaliseRate, expectedForMonth, parseCostModelWorkbook } from "../lib/cost-model-rules.js";

test("classifyBehaviour normalises to FIXED / VARIABLE", () => {
  assert.equal(classifyBehaviour("Fixed"), "FIXED");
  assert.equal(classifyBehaviour("fixed cost"), "FIXED");
  assert.equal(classifyBehaviour("F"), "FIXED");
  assert.equal(classifyBehaviour("Variable"), "VARIABLE");
  assert.equal(classifyBehaviour("var"), "VARIABLE");
  assert.equal(classifyBehaviour("V"), "VARIABLE");
  assert.equal(classifyBehaviour(""), null);
  assert.equal(classifyBehaviour("revenue"), null);
});

test("normaliseRate: percentage vs fraction", () => {
  assert.equal(normaliseRate(40), 0.4);
  assert.equal(normaliseRate(0.4), 0.4);
  assert.equal(normaliseRate(1.5), 1.5);
  assert.equal(normaliseRate(1.6), 0.016);
  assert.equal(normaliseRate(0), null);
  assert.equal(normaliseRate("x"), null);
});

test("expectedForMonth: fixed amount, variable × revenue", () => {
  assert.equal(expectedForMonth({ behaviour: "FIXED", monthly_amount: 12000 }), 12000);
  assert.equal(expectedForMonth({ behaviour: "VARIABLE", pct_of_revenue: 0.4 }, 100000), 40000);
  assert.equal(expectedForMonth({ behaviour: "VARIABLE", pct_of_revenue: 0.4 }, 0), 0);
  assert.equal(expectedForMonth(null, 100000), 0);
});

test("expectedForMonth: fixed respects the start month", () => {
  const exp = { behaviour: "FIXED", monthly_amount: 12000, start_ym: "2026-03" };
  assert.equal(expectedForMonth(exp, 0, { ym: "2026-01" }), 0);      // before start
  assert.equal(expectedForMonth(exp, 0, { ym: "2026-03" }), 12000);  // from start
  assert.equal(expectedForMonth(exp, 0, { ym: "2026-07" }), 12000);
});

test("expectedForMonth: month rate overrides the flat variable rate", () => {
  const exp = { behaviour: "VARIABLE", pct_of_revenue: 0.37 };
  assert.equal(expectedForMonth(exp, 100000, { ym: "2026-07", monthRate: 0.42 }), 42000);
  assert.equal(expectedForMonth(exp, 100000, { ym: "2026-06" }), 37000); // no override → flat
});

function wbFromRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cost model");
  wb._utils = XLSX.utils;
  return wb;
}

test("parseCostModelWorkbook: reads store/nominal/behaviour into records", () => {
  const wb = wbFromRows([
    ["Store", "Nominal", "Behaviour", "Monthly Amount", "% of Revenue"],
    ["Camden", "ST: Rent", "FIXED", 12000, ""],
    ["Camden", "ST: Cost of Goods Sold", "VARIABLE", "", 40],
    ["Oxford Street", "ST: Card Fees", "Variable", "", 1.5],
  ]);
  const { records, warnings, stores } = parseCostModelWorkbook(wb);
  assert.equal(warnings.length, 0);
  assert.equal(records.length, 3);
  assert.deepEqual(stores, ["Camden", "Oxford Street"]);
  const rent = records.find((r) => r.line_label === "ST: Rent");
  assert.equal(rent.behaviour, "FIXED");
  assert.equal(rent.monthly_amount, 12000);
  assert.equal(rent.pct_of_revenue, null);
  const cogs = records.find((r) => r.line_label === "ST: Cost of Goods Sold");
  assert.equal(cogs.behaviour, "VARIABLE");
  assert.equal(cogs.pct_of_revenue, 0.4);
});

test("parseCostModelWorkbook: FIXED without amount / VARIABLE without rate are warned and skipped", () => {
  const wb = wbFromRows([
    ["Store", "Nominal", "Behaviour", "Monthly Amount", "% of Revenue"],
    ["Camden", "ST: Rent", "FIXED", "", ""],
    ["Camden", "ST: COGS", "VARIABLE", "", ""],
    ["Camden", "ST: Rates", "FIXED", 3000, ""],
  ]);
  const { records, warnings } = parseCostModelWorkbook(wb);
  assert.equal(records.length, 1);
  assert.equal(records[0].line_label, "ST: Rates");
  assert.equal(warnings.length, 2);
});

test("parseCostModelWorkbook: no matching tab warns cleanly", () => {
  const wb = wbFromRows([["Foo", "Bar"], [1, 2]]);
  const { records, warnings } = parseCostModelWorkbook(wb);
  assert.equal(records.length, 0);
  assert.ok(warnings[0].includes("No cost-model tab"));
});

test("parseCostModelWorkbook: wide Cost Assumptions + Labour Seasonality", () => {
  const D = (y, m) => new Date(Date.UTC(y, m - 1, 1));
  const ca = [
    ["Cost Assumptions", null, "Camden", "Oxford"],
    [],
    [null, "FIXED COSTS — £ per month"],
    [null, "ST: Rent", 12000, 8000],
    [],
    [null, "FIXED COSTS — Start Date (dd/mm/yyyy)"],
    [null, "ST: Rent", D(2026, 3), D(2026, 1)],
    [],
    [null, "VARIABLE COSTS — % of Sales"],
    [null, "ST: Cost of Goods Sold", 0.37, 0.40],
    [],
    [null, "MONTHLY COST OF GOODS SOLD — % of Sales (per store, per month)."],
    [null, "Month", "Camden", "Oxford"],
    [null, D(2026, 7), 0.42, 0.41],
  ];
  const ls = [
    ["Labour Seasonality", null],
    [],
    [null, "ST: Salaries - Basic Pay  (% of Sales)", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [null, "Camden", 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15],
    [null, "Oxford", 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16, 0.16],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ca), "Cost Assumptions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ls), "Labour Seasonality");
  wb._utils = XLSX.utils;

  const { records, monthRates, stores, warnings } = parseCostModelWorkbook(wb);
  assert.equal(warnings.length, 0);
  assert.deepEqual(stores, ["Camden", "Oxford"]);

  const rent = records.find((r) => r.store === "Camden" && r.line_label === "ST: Rent");
  assert.equal(rent.behaviour, "FIXED");
  assert.equal(rent.monthly_amount, 12000);
  assert.equal(rent.start_ym, "2026-03");
  assert.equal(records.find((r) => r.store === "Oxford" && r.line_label === "ST: Rent").start_ym, "2026-01");

  const cogs = records.find((r) => r.store === "Camden" && r.line_label === "ST: Cost of Goods Sold");
  assert.equal(cogs.behaviour, "VARIABLE");
  assert.equal(cogs.pct_of_revenue, 0.37);
  const cogsJul = monthRates.find((m) => m.store === "Camden" && m.line_label === "ST: Cost of Goods Sold" && m.scope === "YM");
  assert.equal(cogsJul.period_key, "2026-07");
  assert.equal(cogsJul.pct_of_revenue, 0.42);

  // Labour: base VARIABLE record + 12 MONTH rates for Basic Pay
  assert.ok(records.some((r) => r.store === "Camden" && r.line_label === "ST: Salaries - Basic Pay" && r.behaviour === "VARIABLE"));
  const basic = monthRates.filter((m) => m.store === "Camden" && m.line_label === "ST: Salaries - Basic Pay" && m.scope === "MONTH");
  assert.equal(basic.length, 12);
  assert.equal(basic.find((x) => x.period_key === "07").pct_of_revenue, 0.15);
});

test("parseCostModelWorkbook: labour chain folds NI onto % of sales", () => {
  const wb = XLSX.utils.book_new();
  const ls = [
    ["Labour Seasonality", null],
    [],
    [null, "ST: Salaries - Basic Pay  (% of Sales)", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [null, "Camden", 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20],
    [],
    [null, "ST: Salaries - Holiday Pay  (% of Basic Pay)", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [null, "Camden", 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10],
    [],
    [null, "ST: Employers National Insurance  (% of Basic + Holiday)", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [null, "Camden", 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138, 0.138],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ls), "Labour Seasonality");
  wb._utils = XLSX.utils;
  const { monthRates } = parseCostModelWorkbook(wb);
  // basic = 0.20; holiday eff = 0.10*0.20 = 0.02; (basic+holiday) as %sales = 0.20*1.10 = 0.22; NI eff = 0.138*0.22 = 0.03036
  const ni = monthRates.find((m) => m.line_label === "ST: Employers National Insurance" && m.period_key === "01");
  assert.ok(Math.abs(ni.pct_of_revenue - 0.03036) < 1e-9);
  const hol = monthRates.find((m) => m.line_label === "ST: Salaries - Holiday Pay" && m.period_key === "01");
  assert.ok(Math.abs(hol.pct_of_revenue - 0.02) < 1e-9);
});
