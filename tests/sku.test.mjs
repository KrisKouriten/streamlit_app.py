import test from "node:test";
import assert from "node:assert/strict";
import { pareto, newSkus, dormant, asOfMonth, parseSkuCsv } from "../lib/sku-rules.js";

const ROWS = [
  { sku: "A", revenue_ttm: 800, units_ttm: 80, launch_ym: "2024-01", last_sold_ym: "2026-06", stock_value: 100 },
  { sku: "B", revenue_ttm: 120, units_ttm: 40, launch_ym: "2024-01", last_sold_ym: "2026-06", stock_value: 50 },
  { sku: "C", revenue_ttm: 60, units_ttm: 20, launch_ym: "2026-05", last_sold_ym: "2026-06", stock_value: 30 },
  { sku: "D", revenue_ttm: 20, units_ttm: 5, launch_ym: "2026-06", last_sold_ym: "2026-06", stock_value: 20 },
  { sku: "E", revenue_ttm: 0, units_ttm: 0, launch_ym: "2023-01", last_sold_ym: "2025-08", stock_value: 500 },
];

test("as-of month is the latest last-sold month", () => {
  assert.equal(asOfMonth(ROWS), "2026-06");
});

test("pareto: A class drives up to 80% of revenue, tail after", () => {
  const p = pareto(ROWS);
  assert.equal(p.total, 1000);
  assert.equal(p.ranked[0].sku, "A");   // highest revenue first
  assert.equal(p.ranked[0].cls, "A");   // 0→80%
  assert.equal(p.ranked[0].sharePct, 0.8);
  // B starts at 80% cumulative → tail (B class begins at/after 80)
  const b = p.ranked.find((r) => r.sku === "B");
  assert.notEqual(b.cls, "A");
  assert.ok(!p.ranked.some((r) => r.sku === "E")); // zero-revenue excluded
});

test("new SKUs: launched within the window, most recent revenue first", () => {
  const asOf = asOfMonth(ROWS);
  const n = newSkus(ROWS, asOf, 6);
  const skus = n.map((r) => r.sku);
  assert.deepEqual(skus, ["C", "D"]);   // launched 2026-05 and 2026-06
  assert.equal(n[0].months_live, 2);    // May→Jun inclusive
});

test("dormant: no sale within the window or zero revenue, by stock at risk", () => {
  const asOf = asOfMonth(ROWS);
  const d = dormant(ROWS, asOf, 6);
  assert.ok(d.some((r) => r.sku === "E"));      // last sold 2025-08 + zero revenue
  assert.ok(!d.some((r) => r.sku === "A"));     // sold this month
  assert.equal(d[0].sku, "E");                  // highest stock at risk
});

test("SKU CSV parses months, margins as % or decimal, and flags missing SKU", () => {
  const csv = [
    "SKU,Description,Category,Launch Month,Last Sold Month,Units TTM,Revenue TTM,Margin %,Stock Value",
    "SKU-1,Mug,Home,2024-01,2026-06,\"63,500\",\"317,500\",55,22000",
    ",Bad,Home,2024-01,2026-06,1,1,0.5,1",
  ].join("\n");
  const { records, errors } = parseSkuCsv(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].revenue_ttm, 317500);
  assert.equal(records[0].margin_pct, 0.55);
  assert.equal(errors.length, 1);
});
