import { test } from "node:test";
import assert from "node:assert/strict";
import { normName, validateSupplier, headroom, summariseExposure, facilityHeadroom, normSourceType, SUPPLIER_SOURCE_TYPES } from "../lib/suppliers-rules.js";

test("normName lowercases, trims and collapses whitespace", () => {
  assert.equal(normName("  Miniso  HQ "), "miniso hq");
  assert.equal(normName("Design360"), "design360");
  assert.equal(normName(null), "");
});

test("validateSupplier cleans + validates", () => {
  const ok = validateSupplier({ name: "  Top Toy  HK ", credit_limit: "500000", currency: "usd" });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.clean.name, "Top Toy HK");
  assert.equal(ok.clean.norm_name, "top toy hk");
  assert.equal(ok.clean.credit_limit, 500000);
  assert.equal(ok.clean.currency, "USD");
  assert.deepEqual(validateSupplier({ name: "" }).errors, ["Supplier name is required"]);
  assert.ok(validateSupplier({ name: "X", credit_limit: "-5" }).errors.length === 1);
  assert.equal(validateSupplier({ name: "X" }).clean.credit_limit, null); // blank → no limit
});

test("normSourceType canonicalises to MINISO / LOCAL / OTHER (or null)", () => {
  assert.equal(normSourceType("miniso"), "MINISO");
  assert.equal(normSourceType(" Local "), "LOCAL");
  assert.equal(normSourceType("OTHER"), "OTHER");
  assert.equal(normSourceType("services"), null); // not a known code
  assert.equal(normSourceType(""), null);
  assert.deepEqual(SUPPLIER_SOURCE_TYPES.map((s) => s.code), ["MINISO", "LOCAL", "OTHER"]);
});

test("validateSupplier handles payment_days, active_merch and source_type", () => {
  const s = validateSupplier({ name: "ACME", source_type: "local", payment_days: "30", active_merch: false });
  assert.equal(s.errors.length, 0);
  assert.equal(s.clean.source_type, "LOCAL");
  assert.equal(s.clean.payment_days, 30);
  assert.equal(s.clean.active_merch, false);
  // defaults: no source, no terms, in the merch budget
  const d = validateSupplier({ name: "ACME" }).clean;
  assert.equal(d.source_type, null);
  assert.equal(d.payment_days, null);
  assert.equal(d.active_merch, true);
  // negative days rejected
  assert.ok(validateSupplier({ name: "X", payment_days: "-5" }).errors.length === 1);
});

test("headroom: limit vs exposure", () => {
  assert.deepEqual(headroom(100000, 60000), { limit: 100000, exposure: 60000, headroom: 40000, utilisation: 0.6, over: false, near: false });
  const over = headroom(100000, 120000);
  assert.equal(over.over, true);
  assert.equal(over.headroom, -20000);
  assert.equal(headroom(100000, 95000).near, true);       // 95% → near
  assert.equal(headroom(null, 5000).headroom, null);        // no limit set
});

test("summariseExposure rolls up + flags over-limit, worst-first", () => {
  const { rows, totals } = summariseExposure([
    { supplier_id: 1, name: "Alpha", credit_limit: 100000, orderExposure: 40000, facilityOutstanding: 10000 }, // 50k / 100k = 0.5
    { supplier_id: 2, name: "Beta", credit_limit: 50000, orderExposure: 60000, facilityOutstanding: 0 },        // 60k / 50k over
    { supplier_id: 3, name: "Gamma", credit_limit: null, orderExposure: 30000, facilityOutstanding: 0 },        // no limit
  ]);
  assert.equal(rows[0].name, "Beta");                       // worst utilisation first (over-limit)
  assert.equal(rows[0].over, true);
  assert.equal(rows.find((r) => r.name === "Alpha").exposure, 50000);
  assert.equal(totals.suppliers, 3);
  assert.equal(totals.withLimit, 2);
  assert.equal(totals.overLimit, 1);
  assert.equal(totals.totalExposure, 140000);
  assert.equal(totals.totalLimit, 150000);
  assert.equal(totals.totalHeadroom, 40000);                // 150k limit − 110k exposure on limited suppliers
});

test("facilityHeadroom mirrors headroom", () => {
  assert.deepEqual(facilityHeadroom(5000000, 3200000), { limit: 5000000, exposure: 3200000, headroom: 1800000, utilisation: 0.64, over: false, near: false });
});
