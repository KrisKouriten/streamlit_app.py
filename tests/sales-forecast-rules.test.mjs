import test from "node:test";
import assert from "node:assert/strict";
import {
  excelSerialToIso, parseDailySheet, parseSalesForecastWorkbook, storeKey, matchStores,
  forecastStoreCode, versionLabelFromFilename, consolidateForecast, compareForecasts,
} from "../lib/sales-forecast-rules.js";

// A two-store, two-day workbook in the real file's shape.
const HDR = ["Store", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "FY Total"];
const jan = (x) => [x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const monthly = (oxford = 300, trafford = 70) => [
  ["FY2027"], HDR,
  ["COMPANY"], ["Oxford Street", ...jan(oxford), oxford], ["COMPANY SUBTOTAL", ...jan(oxford), oxford],
  ["FRANCHISEE"], ["Trafford", ...jan(trafford), trafford], ["FRANCHISEE SUBTOTAL", ...jan(trafford), trafford],
  ["TOTAL 2027", ...jan(oxford + trafford), oxford + trafford],
];
// 2027-01-01 is Excel serial 46388.
const daily = (a = [100, 200], b = [30, 40]) => [
  ["Daily Sales by Store"], [],
  ["Date", "Day", "Year", "TOTAL (£)", "Co Total", "Fr Total", "Oxford Street", "Trafford"],
  [46388, "Fri", 2027, 0, 0, 0, a[0], b[0]],
  [46389, "Sat", 2027, 0, 0, 0, a[1], b[1]],
  ["GRAND TOTAL", null, null, 0, 0, 0, 0, 0],
];

test("excelSerialToIso reads Excel serials, Dates and ISO text", () => {
  assert.equal(excelSerialToIso(46023), "2026-01-01");
  assert.equal(excelSerialToIso(46388), "2027-01-01");
  assert.equal(excelSerialToIso(new Date(Date.UTC(2027, 0, 2))), "2027-01-02");
  assert.equal(excelSerialToIso("2027-01-03"), "2027-01-03");
  assert.equal(excelSerialToIso("GRAND TOTAL"), null);
});

test("parseDailySheet reads one row per day and one column per store, skipping totals", () => {
  const d = parseDailySheet(daily());
  assert.deepEqual(d.stores, ["Oxford Street", "Trafford"]);
  assert.equal(d.days.length, 4);
  assert.deepEqual(d.days[0], { dateIso: "2027-01-01", store: "Oxford Street", net: 100 });
});

test("parseSalesForecastWorkbook classifies daily columns by the monthly tab", () => {
  const p = parseSalesForecastWorkbook({ monthly: monthly(), daily: daily() });
  assert.deepEqual(p.errors, []);
  assert.equal(p.days.find((x) => x.store === "Trafford").channel, "FRANCHISE");
  assert.equal(p.days.find((x) => x.store === "Oxford Street").channel, "COMPANY");
  assert.deepEqual(p.years["2027"], { company: 300, franchise: 70, total: 370 });
});

test("parseSalesForecastWorkbook refuses daily figures that do not add up to the monthly tab", () => {
  const p = parseSalesForecastWorkbook({ monthly: monthly(), daily: daily([100, 250]) });
  assert.equal(p.errors.length, 1);
  assert.match(p.errors[0], /Oxford Street 2027-01: daily £350 vs monthly £300/);
});

test("storeKey and matchStores match loosely: case, punctuation, St/Street", () => {
  assert.equal(storeKey("Oxford Street"), storeKey("oxford st"));
  assert.equal(storeKey("E-COM"), storeKey("E COM"));
  const master = [{ store_id: 7, store_name: "OXFORD ST" }, { store_id: 9, store_name: "Trafford" }];
  const { matched, missing } = matchStores(
    [{ store: "Oxford Street", channel: "COMPANY" }, { store: "Trafford", channel: "FRANCHISE" }, { store: "Rushmere", channel: "COMPANY" }], master);
  assert.equal(matched.get("Oxford Street"), 7);
  assert.equal(matched.get("Trafford"), 9);
  assert.deepEqual(missing, [{ store: "Rushmere", channel: "COMPANY" }]);
  assert.ok(forecastStoreCode("A very long store name that goes on and on").length <= 30);
});

test("versionLabelFromFilename picks the month and version out of the file name", () => {
  assert.equal(versionLabelFromFilename("2026-2029_Sales_Forecast_4yr_Sept26_v0.3.xlsx"), "Sept26 v0.3");
  assert.equal(versionLabelFromFilename("Oct26 v1.xlsx"), "Oct26 v1");
  assert.equal(versionLabelFromFilename("forecast.xlsx"), "forecast");
});

test("consolidateForecast rolls stores up by month and year, company and franchise", () => {
  const c = consolidateForecast([
    { store: "Oxford Street", channel: "COMPANY", ym: "2027-01", net: 300 },
    { store: "Oxford Street", channel: "COMPANY", ym: "2028-01", net: 330 },
    { store: "Trafford", channel: "FRANCHISE", ym: "2027-01", net: 70 },
  ]);
  assert.deepEqual(c.months["2027-01"], { company: 300, franchise: 70, total: 370 });
  assert.deepEqual(c.years["2028"], { company: 330, franchise: 0, total: 330 });
  assert.deepEqual(c.stores.map((s) => s.store), ["Oxford Street", "Trafford"]);
  assert.equal(c.stores[0].total, 630);
});

test("compareForecasts gives the later version less the earlier", () => {
  const d = compareForecasts({ 2027: { company: 300, franchise: 70, total: 370 } }, { 2027: { company: 310, franchise: 60, total: 370 }, 2028: { company: 5, franchise: 0, total: 5 } });
  assert.deepEqual(d["2027"], { company: 10, franchise: -10, total: 0 });
  assert.deepEqual(d["2028"], { company: 5, franchise: 0, total: 5 });
});
