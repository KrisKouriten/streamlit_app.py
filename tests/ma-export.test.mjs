import test from "node:test";
import assert from "node:assert/strict";
import { applyPeriod, buildTabAoa, monthLabel, PERIOD_LABEL } from "../lib/ma-export-rules.js";

const DATA = {
  year: "2026",
  months: ["2026-02", "2026-01"], // deliberately unsorted — applyPeriod must sort
  rows: [
    { kind: "section", label: "Revenue" },
    { kind: "line", label: "Sales", values: { "2026-01": 100, "2026-02": 150 }, isPct: false },
    { kind: "calc", label: "Gross margin %", values: { "2026-01": 0.5, "2026-02": 0.6 }, isPct: true },
    { kind: "total", label: "Net profit", values: { "2026-01": 30, "2026-02": 40 }, isPct: false },
  ],
};

test("monthLabel formats YYYY-MM as 'Mon YY'", () => {
  assert.equal(monthLabel("2026-01"), "Jan 26");
  assert.equal(monthLabel("2026-12"), "Dec 26");
});

test("current period → latest month only, no total", () => {
  const v = applyPeriod(DATA, "current");
  assert.equal(v.showTotal, false);
  assert.deepEqual(v.cols.map((c) => c.key), ["2026-02"]);
  assert.ok(v.rows.every((r) => r.total === null));
});

test("trailing period → all months sorted, money summed, % total blank", () => {
  const v = applyPeriod(DATA, "trailing");
  assert.equal(v.showTotal, true);
  assert.deepEqual(v.cols.map((c) => c.key), ["2026-01", "2026-02"]);
  const sales = v.rows.find((r) => r.label === "Sales");
  const margin = v.rows.find((r) => r.label === "Gross margin %");
  const net = v.rows.find((r) => r.label === "Net profit");
  assert.equal(sales.total, 250);
  assert.equal(net.total, 70);
  assert.equal(margin.total, null); // a summed margin is meaningless
});

test("ytd period → one cumulative column, % blank", () => {
  const v = applyPeriod(DATA, "ytd");
  assert.equal(v.showTotal, false);
  assert.deepEqual(v.cols.map((c) => c.key), ["__ytd__"]);
  const sales = v.rows.find((r) => r.label === "Sales");
  const margin = v.rows.find((r) => r.label === "Gross margin %");
  assert.equal(sales.values.__ytd__, 250);
  assert.equal(margin.values.__ytd__, null);
});

test("buildTabAoa → header, section as single cell, values, and pct row indices", () => {
  const v = applyPeriod(DATA, "trailing");
  const { aoa, pctRowsIdx, colCount } = buildTabAoa(v, "Store");

  assert.deepEqual(aoa[0], ["Store", "Jan 26", "Feb 26", "Total"]);
  assert.equal(colCount, 4);
  assert.deepEqual(aoa[1], ["Revenue"]); // section collapses to one cell
  assert.deepEqual(aoa[2], ["Sales", 100, 150, 250]);
  assert.deepEqual(aoa[3], ["Gross margin %", 0.5, 0.6, null]);
  assert.deepEqual(aoa[4], ["Net profit", 30, 40, 70]);
  assert.deepEqual(pctRowsIdx, [3]); // the margin row, by aoa index
});

test("buildTabAoa → missing values become blank (null) cells", () => {
  const sparse = { year: "2026", months: ["2026-01"], rows: [{ kind: "line", label: "Odd", values: {}, isPct: false }] };
  const v = applyPeriod(sparse, "current");
  const { aoa } = buildTabAoa(v, "X");
  assert.deepEqual(aoa[1], ["Odd", null]);
});

test("PERIOD_LABEL covers every period", () => {
  assert.equal(PERIOD_LABEL.current, "Current month");
  assert.equal(PERIOD_LABEL.trailing, "Trailing months");
  assert.equal(PERIOD_LABEL.ytd, "YTD");
});
