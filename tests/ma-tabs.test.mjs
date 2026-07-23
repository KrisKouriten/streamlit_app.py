import test from "node:test";
import assert from "node:assert/strict";
import { buildTabs, TAB_ORDER } from "../lib/ma-tabs-rules.js";

// Minimal per-entity actuals: one store, head office, franchise entity.
const rows = [
  // store entity (classified by ST: accounts)
  { entity_id: "s1", entity_name: "Kouriten Brent Cross Limited", section: "Revenue", account: "ST: Sales", ym: "2026-06", value: 1000 },
  { entity_id: "s1", entity_name: "Kouriten Brent Cross Limited", section: "Cost of Sales", account: "ST: Cost of Goods Sold", ym: "2026-06", value: 400 },
  { entity_id: "s1", entity_name: "Kouriten Brent Cross Limited", section: "Expenses", account: "ST: Salaries - Basic Pay", ym: "2026-06", value: 250 },
  { entity_id: "s1", entity_name: "Kouriten Brent Cross Limited", section: "Expenses", account: "ST: Advertising & Marketing", ym: "2026-06", value: 30 },
  { entity_id: "s1", entity_name: "Kouriten Brent Cross Limited", section: "Expenses", account: "ST: Depreciation - Fixtures & Fittings", ym: "2026-06", value: 20 },
  // head office
  { entity_id: "ho", entity_name: "Kouriten Limited", section: "Revenue", account: "HO: Sales - TikTok", ym: "2026-06", value: 800 },
  { entity_id: "ho", entity_name: "Kouriten Limited", section: "Revenue", account: "Franchise Fee - Royalties", ym: "2026-06", value: 60 },
  { entity_id: "ho", entity_name: "Kouriten Limited", section: "Expenses", account: "HO: Goods In", ym: "2026-06", value: 40 },
  { entity_id: "ho", entity_name: "Kouriten Limited", section: "Expenses", account: "HO: Warehouse Storage", ym: "2026-06", value: 60 },
  { entity_id: "ho", entity_name: "Kouriten Limited", section: "Expenses", account: "HO: Advertising & Marketing", ym: "2026-06", value: 15 },
  // franchise entity
  { entity_id: "fr", entity_name: "Kouriten Franchise Limited", section: "Revenue", account: "FR: Franchise Fee - Marketing", ym: "2026-06", value: 22 },
];

test("buildTabs returns all seven tabs", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.deepEqual(Object.keys(tabs).sort(), [...TAB_ORDER].sort());
});

test("Store Sales KPI + by-store table sum the ST: Sales nominal", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.equal(tabs["store-sales"].kpis[0].actual, 1000);
  assert.equal(tabs["store-sales"].table.totalRow.cells[1], 1000);
});

test("Store EBITDA excludes below-EBITDA (depreciation)", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  // 1000 sales − 400 cogs − 250 labour − 30 marketing = 320 (depreciation 20 excluded)
  assert.equal(tabs["store-ebitda"].kpis[0].actual, 320);
});

test("Head Office Sales = HO-prefixed revenue only (excludes franchise fee)", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.equal(tabs["ho-sales"].kpis[0].actual, 800);   // TikTok only, not the £60 royalty
});

test("Warehouse & Logistics sums the four W&L nominals", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.equal(tabs["warehouse-logistics"].kpis[0].actual, 100);  // 40 + 60
});

test("Marketing spans stores + head office nominals", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.equal(tabs["marketing"].kpis[0].actual, 45);   // ST 30 + HO 15
});

test("Franchise Income picks royalties and marketing income", () => {
  const { tabs } = buildTabs(rows, [], { period: "ytd" });
  assert.equal(tabs["franchise-income"].kpis[0].actual, 82);  // 60 royalties + 22 marketing
});
