import test from "node:test";
import assert from "node:assert/strict";

// ---- The 4-year sales forecast workbook, read as it is ----
import { parseSalesForecast4yr, isSalesForecast4yr, FRANCHISE_STORE_SALES_LINE } from "../lib/forecast-rules.js";

const HDR = ["Store", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "FY Total"];
const m12 = (x) => Array.from({ length: 12 }, () => x);
const block = (year, { oxford = 100, rushmere = 50, trafford = 80, fix = 0 } = {}) => [
  [`FY${year}`],
  HDR,
  ["COMPANY"],
  ["Oxford Street", ...m12(oxford), oxford * 12],
  ["Rushmere", ...m12(rushmere).map((v, i) => (i >= 9 ? 0 : v)), rushmere * 9],   // closes Oct
  ["COMPANY SUBTOTAL", ...m12(0).map((_, i) => oxford + (i >= 9 ? 0 : rushmere) + (i === 0 ? fix : 0)), 0],
  ["FRANCHISEE"],
  ["Trafford", ...m12(trafford), trafford * 12],
  ["FRANCHISEE SUBTOTAL", ...m12(trafford), trafford * 12],
  [`TOTAL ${year}`, ...m12(0), 0],
];

test("isSalesForecast4yr recognises the workbook by its Monthly by Store tab", () => {
  assert.equal(isSalesForecast4yr(["1. Summary", "2. Monthly by Store", "3. Daily Sales (All)"]), true);
  assert.equal(isSalesForecast4yr(["Sales Forecast", "Cost Assumptions"]), false);
});

test("parseSalesForecast4yr: company → store sales, franchise → franchise store sales, every month", () => {
  const p = parseSalesForecast4yr([["Monthly Sales by Store"], ...block(2026), ...block(2027, { oxford: 110 })]);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.years["2026"], { company: 1650, franchise: 960, total: 2610 });
  assert.equal(p.years["2027"].company, 110 * 12 + 50 * 9);
  const ox = p.records.filter((r) => r.unit === "Oxford Street");
  assert.equal(ox.length, 24);                                    // Jan 2026 – Dec 2027
  assert.deepEqual(ox[0], { scope: "STORES", unit: "Oxford Street", entity: null, line_label: "ST: Sales", cost_type: "SALES", ym: "2026-01", value: 100 });
  const tr = p.records.find((r) => r.unit === "Trafford");
  assert.equal(tr.scope, "FRANCHISE");
  assert.equal(tr.line_label, FRANCHISE_STORE_SALES_LINE);
  // A closed store's nil months are not loaded as figures.
  assert.equal(p.records.filter((r) => r.unit === "Rushmere" && r.ym === "2026-10").length, 0);
  assert.deepEqual(p.stores, { company: ["Oxford Street", "Rushmere"], franchise: ["Trafford"] });
});

test("parseSalesForecast4yr refuses a year whose stores do not match its subtotal", () => {
  const p = parseSalesForecast4yr(block(2028, { fix: 500 }));
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0], /FY2028: Company stores add up to £1,650, but the subtotal is £2,150/);
});

test("parseSalesForecast4yr says so when there is nothing to read", () => {
  assert.match(parseSalesForecast4yr([["something else"]]).errors[0], /No FY20xx year blocks/);
});

// ---- Consolidated store sales: company + franchise ----
import { consolidatedStoreSales, consolidatedForYear } from "../lib/forecast-rules.js";

test("consolidatedStoreSales adds company and franchise store sales, and only those", () => {
  const lines = [
    { scope: "STORES", unit: "Oxford Street", line_label: "ST: Sales", cost_type: "SALES", ym: "2027-01", value: 100 },
    { scope: "FRANCHISE", unit: "Trafford", line_label: FRANCHISE_STORE_SALES_LINE, cost_type: "SALES", ym: "2027-01", value: 40 },
    { scope: "FRANCHISE", unit: "Bluewater", line_label: FRANCHISE_STORE_SALES_LINE, cost_type: "SALES", ym: "2027-02", value: 60 },
    // Not store sales — must not reach the consolidated figure.
    { scope: "HEAD_OFFICE", unit: null, line_label: "HO: Royalty income", cost_type: "SALES", ym: "2027-01", value: 999 },
    { scope: "FRANCHISE", unit: null, line_label: "FR: Allocation income", cost_type: "SALES", ym: "2027-01", value: 999 },
    { scope: "STORES", unit: "Oxford Street", line_label: "ST: Rent", cost_type: "FIXED", ym: "2027-01", value: 999 },
  ];
  const c = consolidatedStoreSales(lines);
  assert.deepEqual(c.months["2027-01"], { company: 100, franchise: 40, total: 140 });
  assert.deepEqual(consolidatedForYear(c.months, "2027"), { company: 100, franchise: 100, total: 200 });
  assert.deepEqual(consolidatedForYear(c.months, "2028"), { company: 0, franchise: 0, total: 0 });
  assert.deepEqual(c.franchiseStores.map((s) => s.store), ["Bluewater", "Trafford"]);
});

test("consolidated store sales from the real parse match the file's TOTAL rows", () => {
  const p = parseSalesForecast4yr([...block(2027, { oxford: 110 })]);
  const c = consolidatedStoreSales(p.records);
  assert.equal(consolidatedForYear(c.months, "2027").total, p.years["2027"].total);
});
