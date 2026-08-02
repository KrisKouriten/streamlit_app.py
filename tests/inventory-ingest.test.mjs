import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventoryCsv } from "../lib/inventory-ingest-rules.js";

const csv = `Channel,Location,Store,Units,Stock value,Reserved,Damaged,Confidence,Data through
Miniso MDS,Store,ST001,1200,410000,,,,2026-08-01
Miniso MDS,Warehouse,,8000,2000000,300000,100000,,2026-08-02
Miniso MDS,In transit,,4000,1500000,,,0.9,2026-08-01
Local Purchase,Store,ST001,400,120000,,,,2026-08-01`;

test("parseInventoryCsv maps channels, locations and numbers", () => {
  const { rows, errors } = parseInventoryCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 4);
  const wh = rows.find((r) => r.location_type === "WAREHOUSE");
  assert.equal(wh.channel_code, "MINISO_MDS");
  assert.equal(wh.stock_value, 2000000);
  assert.equal(wh.reserved_value, 300000);
  assert.equal(wh.damaged_value, 100000);
  assert.equal(wh.store_code, null);
  const transit = rows.find((r) => r.location_type === "IN_TRANSIT");
  assert.equal(transit.confidence, 0.9);
  const store = rows.find((r) => r.location_type === "STORE" && r.channel_code === "LOCAL_PURCHASE");
  assert.equal(store.store_code, "ST001");
  assert.equal(store.stock_value, 120000);
});

test("parseInventoryCsv strips currency formatting", () => {
  const { rows } = parseInventoryCsv(`Channel,Location,Stock value\nMiniso,Warehouse,"£1,250,000"`);
  assert.equal(rows[0].stock_value, 1250000);
});

test("parseInventoryCsv reports unknown channel/location", () => {
  const { rows, errors } = parseInventoryCsv(`Channel,Location,Stock value\nWholesale,Store,100`);
  assert.equal(rows.length, 0);
  assert.match(errors[0], /unknown channel/i);
});

test("parseInventoryCsv requires channel + location columns", () => {
  const { errors } = parseInventoryCsv(`Foo,Bar\n1,2`);
  assert.match(errors[0], /Channel and Location/i);
});
