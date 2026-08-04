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
