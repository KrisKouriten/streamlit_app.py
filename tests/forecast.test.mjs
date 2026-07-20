import test from "node:test";
import assert from "node:assert/strict";
import { computeForecast, parseForecastCsv } from "../lib/forecast-rules.js";

const L = (scope, unit, line, type, ym, value) => ({ scope, unit, line_label: line, cost_type: type, ym, value });
const LINES = [
  L("STORES", "Camden", "ST: Sales", "SALES", "2026-01", 100000),
  L("STORES", "Camden", "ST: Sales", "SALES", "2026-02", 120000),
  L("STORES", "Ealing", "ST: Sales", "SALES", "2026-01", 50000),
  L("STORES", "Camden", "ST: Cost of Goods Sold", "VARIABLE_RATE", null, 0.4),
  L("STORES", "Ealing", "ST: Cost of Goods Sold", "VARIABLE_RATE", null, 0.5),
  L("STORES", "Camden", "ST: Rent", "FIXED", "2026-01", 10000),
  L("STORES", "Camden", "ST: Rent", "FIXED", "2026-02", 10000),
  L("HEAD_OFFICE", null, "HO: Sales - TikTok", "SALES", "2026-01", 150),
  L("HEAD_OFFICE", null, "HO: Rent", "FIXED", "2026-01", 6432),
  L("FRANCHISE", null, "FR: Franchise Fee - Royalties", "SALES", "2026-01", 65000),
];

test("base: variable costs derive from each store's own sales; EBITDA adds up", () => {
  const { byScope, group } = computeForecast(LINES);
  const jan = byScope.STORES.months["2026-01"];
  assert.equal(jan.sales, 150000);
  assert.equal(jan.variable, 100000 * 0.4 + 50000 * 0.5); // 65,000
  assert.equal(jan.fixed, 10000);
  assert.equal(jan.ebitda, 150000 - 65000 - 10000);
  // Feb: only Camden trades
  const feb = byScope.STORES.months["2026-02"];
  assert.equal(feb.variable, 120000 * 0.4);
  // group consolidates the three scopes
  assert.equal(group.months["2026-01"].sales, 150000 + 150 + 65000);
});

test("scenario levers: sales delta compounds into variable (rate x flexed sales)", () => {
  const { byScope } = computeForecast(LINES, { sales_pct: 0.10, variable_pct: 0.05, fixed_pct: -0.02 });
  const jan = byScope.STORES.months["2026-01"];
  assert.ok(Math.abs(jan.sales - 165000) < 0.01);
  const expectedVar = (110000 * 0.4 + 55000 * 0.5) * 1.05;
  assert.ok(Math.abs(jan.variable - expectedVar) < 0.01);
  assert.ok(Math.abs(jan.fixed - 9800) < 0.01);
});

test("forecast CSV parses scopes, months and rates; bad rows error not load", () => {
  const csv = [
    "Scope,Unit,Line,Cost Type,Month,Value",
    "STORES,Camden,ST: Sales,SALES,2026-03,\"99,000\"",
    "STORES,Camden,ST: Cost of Goods Sold,VARIABLE_RATE,,0.42",
    "HEAD_OFFICE,,HO: Rent,FIXED,2026-03,6432.75",
    "NOWHERE,,X,FIXED,2026-03,1",
    "STORES,Camden,ST: Rent,FIXED,,500",
  ].join("\n");
  const { records, errors } = parseForecastCsv(csv);
  assert.equal(records.length, 3);
  assert.equal(records[0].value, 99000);
  assert.equal(records[1].ym, null);
  assert.equal(errors.length, 2);
});
