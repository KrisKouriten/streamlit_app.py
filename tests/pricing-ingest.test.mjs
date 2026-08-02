import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePricingCsv } from "../lib/pricing-ingest-rules.js";

const csv = `SKU,Channel,Description,Category,RMB Cost,Discount,FX,Sea Freight,Air Freight,Duty,Wholesale Margin,Distributor Margin,Retail VAT,Actual Retail Price,Target GP
A001,Miniso MDS,Mini fan,Electricals,"100","10%","9",1,0.5,0.5,25%,20%,20%,"£30",50%
L045,Local Purchase,Tote bag,Bags,60,0,,0.4,0,0.2,0.3,0.15,0.2,12,0.45`;

test("parsePricingCsv maps fields, channels, numbers and percentages", () => {
  const { rows, errors } = parsePricingCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  const a = rows[0];
  assert.equal(a.sku_code, "A001");
  assert.equal(a.channel_code, "MINISO_MDS");
  assert.equal(a.rmb_cost, 100);
  assert.equal(a.discount_pct, 0.1);     // "10%"
  assert.equal(a.fx_rate, 9);
  assert.equal(a.air_freight, 0.5);
  assert.equal(a.wholesale_margin_pct, 0.25); // "25%"
  assert.equal(a.retail_vat_pct, 0.2);
  assert.equal(a.actual_retail_price, 30);    // "£30"
  assert.equal(a.target_gp_pct, 0.5);         // "50%"
  const l = rows[1];
  assert.equal(l.channel_code, "LOCAL_PURCHASE");
  assert.equal(l.distributor_margin_pct, 0.15); // "0.15" already a fraction
});

test("percentages accept fraction, whole number or percent forms", () => {
  const { rows } = parsePricingCsv(`SKU,Channel,Wholesale Margin\nX,Miniso,30`);
  assert.equal(rows[0].wholesale_margin_pct, 0.3); // "30" → 0.30
});

test("requires SKU + Channel; flags unknown channel", () => {
  assert.match(parsePricingCsv(`Foo,Bar\n1,2`).errors[0], /SKU and Channel/i);
  const { rows, errors } = parsePricingCsv(`SKU,Channel\nA1,Wholesale`);
  assert.equal(rows.length, 0);
  assert.match(errors[0], /unknown channel/i);
});
