import test from "node:test";
import assert from "node:assert/strict";
import { computeForecast, parseForecastCsv, parseForecastWorkbook } from "../lib/forecast-rules.js";

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

test("per-month variable rate overrides the constant default for that month only", () => {
  const lines = [
    L("STORES", "Camden", "ST: Sales", "SALES", "2026-01", 100000),
    L("STORES", "Camden", "ST: Sales", "SALES", "2026-02", 100000),
    // constant COGS rate 0.40, but a seasonal override of 0.30 for Feb only
    L("STORES", "Camden", "ST: Cost of Goods Sold", "VARIABLE_RATE", null, 0.40),
    L("STORES", "Camden", "ST: Cost of Goods Sold", "VARIABLE_RATE", "2026-02", 0.30),
  ];
  const { byScope } = computeForecast(lines);
  assert.equal(byScope.STORES.months["2026-01"].variable, 100000 * 0.40); // default
  assert.equal(byScope.STORES.months["2026-02"].variable, 100000 * 0.30); // override
});

/* --- workbook parser: build a minimal 3-tab workbook object by hand -------- */
// Emulate a SheetJS workbook: sheet_to_json({header:1,raw:true}) over a 2-D grid.
function fakeWorkbook(sheets) {
  const gridToWs = (grid) => ({ _grid: grid });
  const Sheets = {}; const SheetNames = [];
  for (const [name, grid] of Object.entries(sheets)) { Sheets[name] = gridToWs(grid); SheetNames.push(name); }
  return {
    Sheets, SheetNames,
    _utils: { sheet_to_json: (ws) => ws._grid.map((r) => r.slice()) },
  };
}
const D = (y, m) => new Date(Date.UTC(y, m - 1, 1)); // month-1 date

test("parseForecastWorkbook: sales carry entity; fixed expand from start; seasonal COGS + labour become month rates", () => {
  const jan = D(2026, 1), feb = D(2026, 2);
  const wb = fakeWorkbook({
    "Sales Forecast": [
      ["Store Number", "Entity", "Store", jan, feb],
      [1, "Miniso UK Camden Limited", "Camden", 100000, 120000],
    ],
    "Cost Assumptions": [
      ["", "Cost Assumptions", "Camden"],
      ["", "Fixed Costs (£)", ""],
      ["", "ST: Rent", 10000],
      ["", "Fixed Costs — start", ""],
      ["", "ST: Rent", feb], // rent only starts Feb
      ["", "Variable Costs (% of sales)", ""],
      ["", "ST: Distribution Costs", 0.02],
      ["", "Monthly Cost of Goods (%)", ""],
      ["", "Month", "Camden"],
      ["", jan, 0.40],
      ["", feb, 0.30],
    ],
    "Labour Seasonality": [
      ["Store Number", "Store", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      [1, "Camden", 0.11, 0.12, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10],
    ],
  });
  const { records, storeEntity, warnings, months } = parseForecastWorkbook(wb);
  assert.deepEqual(months, ["2026-01", "2026-02"]);
  assert.equal(storeEntity["Camden"], "Miniso UK Camden Limited");

  const sales = records.filter((r) => r.cost_type === "SALES");
  assert.equal(sales.length, 2);
  assert.ok(sales.every((r) => r.entity === "Miniso UK Camden Limited"));

  // Rent starts Feb → only one FIXED rent line, for 2026-02
  const rent = records.filter((r) => r.cost_type === "FIXED" && r.line_label === "ST: Rent");
  assert.equal(rent.length, 1);
  assert.equal(rent[0].ym, "2026-02");
  assert.equal(rent[0].value, 10000);

  // Seasonal COGS → month-specific VARIABLE_RATE
  const cogsJan = records.find((r) => r.line_label === "ST: Cost of Goods Sold" && r.ym === "2026-01");
  const cogsFeb = records.find((r) => r.line_label === "ST: Cost of Goods Sold" && r.ym === "2026-02");
  assert.equal(cogsJan.value, 0.40);
  assert.equal(cogsFeb.value, 0.30);

  // Labour seasonality → month-specific VARIABLE_RATE on basic pay
  const labFeb = records.find((r) => r.line_label === "ST: Salaries - Basic Pay" && r.ym === "2026-02");
  assert.equal(labFeb.value, 0.12);

  assert.equal(warnings.length, 0);

  // End-to-end: the parsed records compute a coherent P&L
  const { byScope } = computeForecast(records);
  const janM = byScope.STORES.months["2026-01"];
  // variable = COGS(0.40) + distribution(0.02) + labour(0.11) = 0.53 × 100000
  assert.ok(Math.abs(janM.variable - 100000 * (0.40 + 0.02 + 0.11)) < 0.01);
  assert.equal(janM.fixed, 0); // rent hasn't started in Jan
  const febM = byScope.STORES.months["2026-02"];
  assert.equal(febM.fixed, 10000); // rent starts Feb
});
