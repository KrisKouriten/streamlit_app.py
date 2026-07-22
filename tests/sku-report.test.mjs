import test from "node:test";
import assert from "node:assert/strict";
import { mapSheet, parseTop80, toStorageRows, sanitize, parseNewSku } from "../lib/sku-report-rules.js";

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

test("parseNewSku: big picture, stars/slow/zero split, and store scorecard", () => {
  // SKU-level cols 0-12, then a 4-col block per store (Sales, SOH, First Rcvd, ST%).
  const H = ["SKU", "Description", "Category", "Price", "First Received", "GR Qty", "Units Sold", "Sell-Through %", "Net Sales", "Total SOH", "SOH Retail", "Stores Stocked", "Stores Selling", "Wembley", null, null, null, "Camden", null, null, null];
  const sub = [null, null, null, null, null, null, null, null, null, null, null, null, null, "Sales", "SOH", "First Rcvd", "ST%", "Sales", "SOH", "First Rcvd", "ST%"];
  const star = ["A1", "Pokemon Pack", "Toys", 18, "26 Mar", 100, 90, 0.9, 1200, 10, 200, 5, 4, 700, null, "26 Mar", 1, 500, null, "26 Mar", 1];
  const slow = ["A2", "Kitty Box", "Trendy Toy", 16, "26 Mar", 100, 5, 0.05, 80, 95, 1500, 8, 2, 80, 40, "26 Mar", 0.05, null, 20, "26 Mar", 0];
  const zero = ["A3", "Dud Item", "Home", 10, "26 Mar", 50, 0, 0, 0, 50, 500, 3, 0, null, 25, "26 Mar", 0, null, null, null, null];
  const p = parseNewSku([H, sub, star, slow, zero]);

  const kpi = (l) => p.bigPicture.find((m) => m.label === l).value;
  assert.equal(kpi("New SKUs received"), 3);
  assert.ok(Math.abs(kpi("Hit rate") - 2 / 3) < 1e-9);       // 2 of 3 sold
  assert.equal(kpi("Total sales (L4W)"), 1280);              // 1200 + 80
  assert.equal(kpi("Zero sellers"), 1);
  assert.ok(Math.abs(kpi("Estate sell-through") - 95 / 250) < 1e-9); // (90+5+0)/(100+100+50)
  assert.equal(kpi("SOH at risk (<15% ST)"), 2000);          // slow 1500 + zero 500

  assert.equal(p.stars.length, 1); assert.equal(p.stars[0].Product, "Pokemon Pack");
  assert.equal(p.slow.length, 1); assert.equal(p.slow[0].Product, "Kitty Box");
  assert.equal(p.zero.length, 1); assert.equal(p.zero[0].Product, "Dud Item");

  const wembley = p.storeScorecard.find((s) => s.Store === "Wembley");
  assert.ok(wembley); assert.equal(wembley["New SKUs"], 3);  // stocked at Wembley in all three rows
  assert.equal(wembley["SKUs Selling"], 2);                  // 700 and 80 sales; zero row has no sales
});

test("toStorageRows flattens with a meta row carrying the period", () => {
  const rows = toStorageRows({ period: "Miniso UK Stores", exec: [{ label: "X", value: 1 }], top80Store: [], bottom20Store: [], licence: [], zeroSellers: [], zeroCount: 0 });
  assert.equal(rows[0].sheet_key, "meta");
  assert.equal(rows[0].data.period, "Miniso UK Stores");
  assert.ok(rows.some((r) => r.sheet_key === "exec"));
});
