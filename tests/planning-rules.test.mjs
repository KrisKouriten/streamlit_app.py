import test from "node:test";
import assert from "node:assert/strict";
import {
  transactionsFrom, calculatedSales, buildStoreSales, resolveAssumption,
  validateDriverDefinition, validateAssumption, PLANNING_SCOPES, ASSUMPTION_LEVELS,
  computeStoreSalesLines, monthsBetween, computeFixedCostLines, computePctOfSalesLines, validateCostRule,
} from "../lib/planning-rules.js";

test("transactions = footfall × conversion", () => {
  assert.equal(Math.round(transactionsFrom(210000, 0.135)), 28350);
});

test("calculated sales = footfall × conversion × ATV", () => {
  assert.equal(Math.round(calculatedSales(210000, 0.135, 8.75)), 248063);
});

test("buildStoreSales CORE — full ladder, no adjustment", () => {
  const r = buildStoreSales({ method: "CORE", footfall: 210000, conversion: 0.135, atv: 8.75 });
  assert.equal(r.transactions, 28350);
  assert.equal(r.calculatedSales, 248062.5);
  assert.equal(r.managementAdjustment, 0);
  assert.equal(r.finalSales, 248062.5);
});

test("buildStoreSales HYBRID — adjustment is separate and does not overwrite the calculation", () => {
  const r = buildStoreSales({ method: "HYBRID", footfall: 210000, conversion: 0.135, atv: 8.75, adjustmentAmount: 6937.5 });
  assert.equal(r.calculatedSales, 248062.5);        // calculation preserved
  assert.equal(r.managementAdjustment, 6937.5);
  assert.equal(r.finalSales, 255000);               // calc + adjustment
});

test("buildStoreSales HYBRID — percentage adjustment when no amount given", () => {
  const r = buildStoreSales({ method: "HYBRID", footfall: 100000, conversion: 0.1, atv: 10, adjustmentPct: 0.05 });
  assert.equal(r.calculatedSales, 100000);
  assert.equal(r.managementAdjustment, 5000);
  assert.equal(r.finalSales, 105000);
});

test("buildStoreSales DIRECT — uses direct sales, ignores drivers for the total", () => {
  const r = buildStoreSales({ method: "DIRECT", directSales: 300000, footfall: 210000, conversion: 0.135, atv: 8.75 });
  assert.equal(r.calculatedSales, 300000);
  assert.equal(r.finalSales, 300000);
});

test("computeStoreSalesLines — CORE month with full lineage", () => {
  const [line] = computeStoreSalesLines(
    [{ period: "2026-01", method: "CORE", footfall: 210000, conversion: 0.135, atv: 8.75 }]);
  assert.equal(line.period, "2026-01");
  assert.equal(line.nominal, "ST: Sales");
  assert.equal(line.source, "SALES_DRIVER");
  assert.equal(line.amount, 248062.5);
  assert.equal(line.lineage.transactions, 28350);
  assert.equal(line.lineage.managementAdjustment, 0);
});

test("computeStoreSalesLines — HYBRID keeps calc + adjustment separate in lineage", () => {
  const [line] = computeStoreSalesLines(
    [{ period: "2026-02", method: "HYBRID", footfall: 210000, conversion: 0.135, atv: 8.75, adjustment_amount: 6937.5 }]);
  assert.equal(line.lineage.calculatedSales, 248062.5);
  assert.equal(line.lineage.managementAdjustment, 6937.5);
  assert.equal(line.amount, 255000);
});

test("computeStoreSalesLines — blank drivers fall back to the assumption resolver", () => {
  const resolveDriver = (code) => ({ FOOTFALL: 100000, CONVERSION: 0.10, ATV: 10 }[code]);
  const [line] = computeStoreSalesLines(
    [{ period: "2026-03", method: "CORE" }], { resolveDriver });
  assert.equal(line.lineage.footfall, 100000);
  assert.equal(line.amount, 100000); // 100000 × 0.10 × 10
});

test("computeStoreSalesLines — custom nominal (e.g. franchise retail)", () => {
  const [line] = computeStoreSalesLines(
    [{ period: "2026-01", method: "DIRECT", direct_sales: 50000 }], { nominal: "FR: Retail Sales" });
  assert.equal(line.nominal, "FR: Retail Sales");
  assert.equal(line.amount, 50000);
});

test("monthsBetween — inclusive, crosses year boundary", () => {
  assert.deepEqual(monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsBetween("2026-06", "2026-06"), ["2026-06"]);
  assert.deepEqual(monthsBetween(null, "2026-06"), []);
});

test("computeFixedCostLines — recurring rule generates each month at the base amount", () => {
  const lines = computeFixedCostLines({ nominal: "ST: Rent", monthly_amount: 5000, start_period: "2026-01", end_period: "2026-03" });
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.amount === 5000 && l.nominal === "ST: Rent" && l.source === "FIXED"));
});

test("computeFixedCostLines — annual increase escalates by year from the start", () => {
  const lines = computeFixedCostLines({ nominal: "ST: Rent", monthly_amount: 1000, annual_increase_pct: 0.10, start_period: "2026-12", end_period: "2027-01" });
  assert.equal(lines.find((l) => l.period === "2026-12").amount, 1000);
  assert.equal(lines.find((l) => l.period === "2027-01").amount, 1100); // +10% in the next year
});

test("computeFixedCostLines — a per-month override replaces only that month", () => {
  const lines = computeFixedCostLines(
    { nominal: "ST: Rent", monthly_amount: 5000, start_period: "2026-01", end_period: "2026-03" },
    [{ period: "2026-02", amount: 8000 }]);
  assert.equal(lines.find((l) => l.period === "2026-01").amount, 5000);
  assert.equal(lines.find((l) => l.period === "2026-02").amount, 8000);
  assert.equal(lines.find((l) => l.period === "2026-02").lineage.overridden, true);
  assert.equal(lines.find((l) => l.period === "2026-03").amount, 5000);
});

test("computePctOfSalesLines — rate × sales base per period, recalculates with sales", () => {
  const lines = computePctOfSalesLines({ nominal: "ST: Merchant Fees", rate: 0.0135, sales_base: "ST: Sales" }, { "2026-01": 248062.5, "2026-02": 255000 });
  assert.equal(lines.find((l) => l.period === "2026-01").amount, 3348.84);
  assert.equal(lines.find((l) => l.period === "2026-02").amount, 3442.5);
  assert.equal(lines[0].lineage.rate, 0.0135);
  assert.equal(lines[0].lineage.base_amount, 248062.5);
});

test("validateCostRule enforces behaviour-specific requirements", () => {
  assert.equal(validateCostRule({ scope: "COMPANY_STORE", nominal: "ST: Rent", behaviour: "FIXED_MONTHLY", monthly_amount: 5000, start_period: "2026-01", end_period: "2026-12" }), null);
  assert.equal(validateCostRule({ scope: "COMPANY_STORE", nominal: "ST: Merchant Fees", behaviour: "PCT_OF_SALES", rate: 0.0135 }), null);
  assert.match(validateCostRule({ scope: "COMPANY_STORE", nominal: "ST: Rent", behaviour: "FIXED_MONTHLY", monthly_amount: 5000 }), /start and end/);
  assert.match(validateCostRule({ scope: "COMPANY_STORE", nominal: "X", behaviour: "PCT_OF_SALES" }), /rate/);
  assert.match(validateCostRule({ scope: "COMPANY_STORE", nominal: "X", behaviour: "NOPE" }), /behaviour/);
});

// ---- Assumption resolution -------------------------------------------------

const CONV = [
  { assumption_id: 1, driver_code: "CONVERSION", scope: "COMPANY_STORE", level: "COMPANY", level_key: null, scenario_code: "BASE", period: null, value: 0.125, approval_status: "APPROVED" },
  { assumption_id: 2, driver_code: "CONVERSION", scope: "COMPANY_STORE", level: "REGION", level_key: "South", scenario_code: "BASE", period: null, value: 0.130, approval_status: "APPROVED" },
  { assumption_id: 3, driver_code: "CONVERSION", scope: "COMPANY_STORE", level: "STORE", level_key: "K-BRIGHTON", scenario_code: "BASE", period: null, value: 0.138, approval_status: "APPROVED" },
];

test("resolveAssumption — most specific approved level wins (store > region > company)", () => {
  const r = resolveAssumption(CONV, { driverCode: "CONVERSION", scope: "COMPANY_STORE", storeCode: "K-BRIGHTON", region: "South", scenario: "BASE" });
  assert.equal(r.value, 0.138);
  assert.equal(r.level, "STORE");
});

test("resolveAssumption — falls back to region when no store override", () => {
  const r = resolveAssumption(CONV, { driverCode: "CONVERSION", scope: "COMPANY_STORE", storeCode: "K-LEEDS", region: "South", scenario: "BASE" });
  assert.equal(r.value, 0.130);
  assert.equal(r.level, "REGION");
});

test("resolveAssumption — falls back to company when neither store nor region match", () => {
  const r = resolveAssumption(CONV, { driverCode: "CONVERSION", scope: "COMPANY_STORE", storeCode: "K-LEEDS", region: "North", scenario: "BASE" });
  assert.equal(r.value, 0.125);
  assert.equal(r.level, "COMPANY");
});

test("resolveAssumption — a period-specific row beats the constant for that month", () => {
  const rows = [
    { assumption_id: 10, driver_code: "ATV", scope: "COMPANY_STORE", level: "STORE", level_key: "K1", scenario_code: "BASE", period: null, value: 8.50, approval_status: "APPROVED" },
    { assumption_id: 11, driver_code: "ATV", scope: "COMPANY_STORE", level: "STORE", level_key: "K1", scenario_code: "BASE", period: "2026-12", value: 9.20, approval_status: "APPROVED" },
  ];
  assert.equal(resolveAssumption(rows, { driverCode: "ATV", scope: "COMPANY_STORE", storeCode: "K1", period: "2026-12", scenario: "BASE" }).value, 9.20);
  assert.equal(resolveAssumption(rows, { driverCode: "ATV", scope: "COMPANY_STORE", storeCode: "K1", period: "2026-06", scenario: "BASE" }).value, 8.50);
});

test("resolveAssumption — unapproved rows are ignored unless includeDrafts", () => {
  const rows = [
    { assumption_id: 20, driver_code: "ATV", scope: "COMPANY_STORE", level: "COMPANY", level_key: null, scenario_code: "BASE", period: null, value: 8.00, approval_status: "APPROVED" },
    { assumption_id: 21, driver_code: "ATV", scope: "COMPANY_STORE", level: "STORE", level_key: "K1", scenario_code: "BASE", period: null, value: 9.99, approval_status: "DRAFT" },
  ];
  assert.equal(resolveAssumption(rows, { driverCode: "ATV", scope: "COMPANY_STORE", storeCode: "K1", scenario: "BASE" }).value, 8.00);
  assert.equal(resolveAssumption(rows, { driverCode: "ATV", scope: "COMPANY_STORE", storeCode: "K1", scenario: "BASE", includeDrafts: true }).value, 9.99);
});

test("resolveAssumption — scenario filters the candidates", () => {
  const rows = [
    { assumption_id: 30, driver_code: "CONVERSION", scope: "COMPANY_STORE", level: "COMPANY", level_key: null, scenario_code: "BASE", period: null, value: 0.12, approval_status: "APPROVED" },
    { assumption_id: 31, driver_code: "CONVERSION", scope: "COMPANY_STORE", level: "COMPANY", level_key: null, scenario_code: "UPSIDE", period: null, value: 0.15, approval_status: "APPROVED" },
  ];
  assert.equal(resolveAssumption(rows, { driverCode: "CONVERSION", scope: "COMPANY_STORE", scenario: "UPSIDE" }).value, 0.15);
});

test("resolveAssumption — null when nothing applies", () => {
  assert.equal(resolveAssumption(CONV, { driverCode: "FOOTFALL", scope: "COMPANY_STORE", storeCode: "K1", scenario: "BASE" }), null);
});

// ---- Validation ------------------------------------------------------------

test("validateDriverDefinition catches bad category/scope", () => {
  assert.equal(validateDriverDefinition({ driver_code: "X", description: "d", category: "SALES", permitted_scopes: ["COMPANY_STORE"] }), null);
  assert.match(validateDriverDefinition({ driver_code: "X", description: "d", category: "NOPE" }), /category/);
  assert.match(validateDriverDefinition({ driver_code: "X", description: "d", category: "SALES", permitted_scopes: ["BOGUS"] }), /scope/i);
  assert.match(validateDriverDefinition({ description: "d", category: "SALES" }), /code/i);
});

test("validateAssumption enforces level key, value and period format", () => {
  assert.equal(validateAssumption({ driver_code: "ATV", scope: "COMPANY_STORE", level: "STORE", level_key: "K1", value: 8.5 }), null);
  assert.match(validateAssumption({ driver_code: "ATV", scope: "COMPANY_STORE", level: "STORE", value: 8.5 }), /store key/i);
  assert.match(validateAssumption({ driver_code: "ATV", scope: "COMPANY_STORE", level: "COMPANY", value: "x" }), /numeric/);
  assert.match(validateAssumption({ driver_code: "ATV", scope: "COMPANY_STORE", level: "COMPANY", value: 1, period: "2026/12" }), /YYYY-MM/);
  assert.match(validateAssumption({ driver_code: "ATV", scope: "BOGUS", level: "COMPANY", value: 1 }), /scope/i);
});

test("vocabulary exports are present", () => {
  assert.ok(PLANNING_SCOPES.includes("COMPANY_STORE"));
  assert.ok(PLANNING_SCOPES.includes("CONSOLIDATION_ADJUSTMENT"));
  assert.deepEqual(ASSUMPTION_LEVELS, ["COMPANY", "REGION", "ENTITY", "STORE"]);
});
