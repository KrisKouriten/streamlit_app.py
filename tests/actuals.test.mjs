import test from "node:test";
import assert from "node:assert/strict";
import { classifyNominal, parseActualsWorkbook, computeMgmtAccounts } from "../lib/actuals-rules.js";

const L = (unit, line, type, ym, value) => ({ scope: "STORES", unit, line_label: line, cost_type: type, ym, value });

test("classifyNominal: revenue / below-EBITDA / cost", () => {
  assert.equal(classifyNominal("ST: Sales"), "REVENUE");
  assert.equal(classifyNominal("ST: Depreciation - Store Equipment"), "BELOW");
  assert.equal(classifyNominal("ST: PayPal Fees"), "BELOW");
  assert.equal(classifyNominal("ST: Rent"), "COST");
  assert.equal(classifyNominal("ST: Cost of Goods Sold"), "COST");
});

test("computeMgmtAccounts: actuals lead where present, forecast forward, EBITDA", () => {
  const forecast = [
    L("Camden", "ST: Sales", "SALES", "2026-01", 100000),
    L("Camden", "ST: Sales", "SALES", "2026-02", 100000),
    L("Camden", "ST: Sales", "SALES", "2026-03", 100000),
    L("Camden", "ST: Cost of Goods Sold", "VARIABLE_RATE", null, 0.40),
  ];
  const actuals = [
    { scope: "STORES", unit: "Camden", line_label: "ST: Sales", ym: "2026-01", value: 120000 },
    { scope: "STORES", unit: "Camden", line_label: "ST: Cost of Goods Sold", ym: "2026-01", value: 50000 },
  ];
  const ma = computeMgmtAccounts(forecast, actuals, { scope: "STORES", unit: "Camden" });
  assert.deepEqual(ma.actualMonths, ["2026-01"]);
  assert.equal(ma.isActualMonth["2026-01"], true);
  assert.equal(ma.isActualMonth["2026-02"], false);

  const sales = ma.rows.find((r) => r.line_label === "ST: Sales");
  assert.equal(sales.current["2026-01"], 120000); // actual leads Jan
  assert.equal(sales.current["2026-02"], 100000); // forecast forward
  assert.equal(sales.budget["2026-01"], 100000);

  const cogs = ma.rows.find((r) => r.line_label === "ST: Cost of Goods Sold");
  assert.equal(cogs.current["2026-01"], 50000); // actual
  assert.equal(cogs.current["2026-02"], 40000); // 0.40 × 100000 budget

  // EBITDA: current Jan = 120k - 50k = 70k; budget Jan = 100k - 40k = 60k
  assert.equal(ma.totals.current.ebitda.months["2026-01"], 70000);
  assert.equal(ma.totals.budget.ebitda.months["2026-01"], 60000);
  // current full = actual Jan + forecast Feb/Mar: sales 320k, cogs 130k, ebitda 190k
  assert.equal(ma.totals.current.revenue.total, 320000);
  assert.equal(ma.totals.current.ebitda.total, 320000 - 130000);
});

// parse the long tab
function fakeWb(grid) {
  return { SheetNames: ["P&L Actuals"], Sheets: { "P&L Actuals": { g: grid } }, _utils: { sheet_to_json: (ws) => ws.g.map((r) => r.slice()) } };
}
test("parseActualsWorkbook: reads Entity/Store/Month/Nominal/Value long tab", () => {
  const wb = fakeWb([
    ["Ref", "Entity", "Concat", null, "Store", "TAB", "Month", "Nominals", "Value"],
    [0, "Kouriten Camden Limited", "x", null, "Camden", null, new Date(Date.UTC(2026, 0, 31)), "ST: Sales", 120000],
    [0, "Kouriten Camden Limited", "x", null, "Camden", null, new Date(Date.UTC(2026, 0, 31)), "ST: Rent", 8000],
    [0, "", "", null, "", null, null, "", null], // junk row skipped
  ]);
  const { records, months } = parseActualsWorkbook(wb);
  assert.equal(records.length, 2);
  assert.deepEqual(months, ["2026-01"]);
  assert.equal(records[0].unit, "Camden");
  assert.equal(records[0].entity, "Kouriten Camden Limited");
  assert.equal(records[0].line_label, "ST: Sales");
  assert.equal(records[0].value, 120000);
});
