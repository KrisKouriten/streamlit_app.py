import test from "node:test";
import assert from "node:assert/strict";
import { mapSheet, parseTop80, toStorageRows, sanitize } from "../lib/sku-report-rules.js";

test("sanitize rewrites Kouriten → Miniso UK in display text", () => {
  assert.equal(sanitize("Kouriten Stores"), "Miniso UK Stores");
  assert.equal(sanitize(1308), 1308);
});

test("mapSheet finds the header row and maps rows to objects", () => {
  const aoa = [
    ["Top 80% Store Scorecard — Kouriten"],
    ["All 30 stores ranked by winner sales."],
    ["Store", "Total Sales", "Winner %"],
    ["Oxford Street", 154176.67, 0.7871],
    ["Camden", 145492.49, 0.7554],
    [null],
  ];
  const { rows } = mapSheet(aoa, "Store");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { Store: "Oxford Street", "Total Sales": 154176.67, "Winner %": 0.7871 });
});

test("parseTop80 extracts exec metrics, scorecards, licence and top-200 zero sellers", () => {
  const sheets = {
    "Executive Summary": [["MINISO UK — TOP 80%"], ["Kouriten Stores · 30 stores"], ["KEY METRICS"], ["Total Products Sold", 6576], ["Top 80% Products", 1308], ["Top 80% GM", 0.661]],
    "Top 80% Store": [["Top 80% Store Scorecard"], ["sub"], ["Store", "Winner %"], ["Oxford Street", 0.79]],
    "Bottom 20% Store": [["Bottom 20%"], ["sub"], ["Store", "Slow Stock %"], ["Milton Keynes", 0.58]],
    "Licence Analysis": [["Licence Analysis"], ["sub"], ["Licence", "Winner Sales"], ["Sanrio", 395788.64]],
    "Zero Sellers": [["Zero"], ["sub"], ["SKU", "SOH Cost"], ...Array.from({ length: 250 }, (_, i) => [`SKU${i}`, i])],
  };
  const p = parseTop80(sheets);
  assert.equal(p.period, "Miniso UK Stores · 30 stores");     // sanitised
  assert.equal(p.exec.find((m) => m.label === "Top 80% Products").value, 1308);
  assert.equal(p.top80Store[0]["Winner %"], 0.79);
  assert.equal(p.bottom20Store[0].Store, "Milton Keynes");
  assert.equal(p.licence[0].Licence, "Sanrio");
  assert.equal(p.zeroCount, 250);
  assert.equal(p.zeroSellers.length, 200);                    // capped
  assert.equal(p.zeroSellers[0]["SOH Cost"], 249);            // sorted desc by SOH Cost
});

test("toStorageRows flattens with a meta row carrying the period", () => {
  const rows = toStorageRows({ period: "Miniso UK Stores", exec: [{ label: "X", value: 1 }], top80Store: [], bottom20Store: [], licence: [], zeroSellers: [], zeroCount: 0 });
  assert.equal(rows[0].sheet_key, "meta");
  assert.equal(rows[0].data.period, "Miniso UK Stores");
  assert.ok(rows.some((r) => r.sheet_key === "exec"));
});
