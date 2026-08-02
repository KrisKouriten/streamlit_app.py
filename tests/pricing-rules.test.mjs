import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCostBuild, totalFreight, computePriceChain, marginAnalysis, priceForTargetGp,
  freightBurden, classifyAbc, classifyXyz, healthScore, healthBand, whatIf, priceSku,
  FREIGHT_COMPONENTS, PRICING_CHANNELS,
} from "../lib/pricing-rules.js";

const sku = {
  rmb_cost: 100, discount_pct: 0.1, fx_rate: 9,
  sea_freight: 1, air_freight: 0.5, duty: 0.5, insurance: 0.2, port_charges: 0.3, customs: 0.2, other_import: 0.3,
  goods_in: 0.5, goods_out: 0.5, warehouse_storage: 0.3, warehouse_admin: 0.2, handling: 0.3, other_logistics: 0.2,
  wholesale_margin_pct: 0.25, distributor_margin_pct: 0.2, retail_vat_pct: 0.2,
  actual_retail_price: 30, target_gp_pct: 0.5,
};

test("air freight is part of total freight (never separate)", () => {
  assert.ok(FREIGHT_COMPONENTS.includes("air_freight"));
  assert.equal(totalFreight(sku), 3.0); // 1 + 0.5 + 0.5 + 0.2 + 0.3 + 0.2 + 0.3
});

test("computeCostBuild chains RMB → FOB → freight → landed → distribution → total", () => {
  const b = computeCostBuild(sku);
  assert.equal(b.netRmb, 90);      // 100 × (1 − 0.1)
  assert.equal(b.gbpFob, 10);      // 90 / 9
  assert.equal(b.freight, 3);
  assert.equal(b.landed, 13);      // FOB 10 + freight 3
  assert.equal(b.distribution, 2); // 0.5+0.5+0.3+0.2+0.3+0.2
  assert.equal(b.totalCost, 15);   // landed 13 + distribution 2
});

test("computePriceChain applies margins on selling price + VAT", () => {
  const c = computePriceChain(15, { wholesaleMargin: 0.25, distributorMargin: 0.2, vat: 0.2 });
  assert.equal(c.wholesale, 20);     // 15 / 0.75
  assert.equal(c.distributor, 25);   // 20 / 0.8
  assert.equal(c.retailExVat, 25);
  assert.equal(c.rrpInclVat, 30);    // 25 × 1.2
});

test("computePriceChain guards a margin ≥ 100%", () => {
  const c = computePriceChain(15, { wholesaleMargin: 1.0, distributorMargin: 0.2 });
  assert.equal(c.wholesale, null);
  assert.equal(c.rrpInclVat, null);
});

test("marginAnalysis from an incl-VAT selling price", () => {
  const m = marginAnalysis({ sellingInclVat: 30, totalCost: 15, vat: 0.2 });
  assert.equal(m.sellingExVat, 25);
  assert.equal(m.gp, 10);
  assert.equal(m.gpPct, 0.4);
  assert.equal(m.markup, 0.6667);
});

test("priceForTargetGp inverts to a target margin", () => {
  const p = priceForTargetGp(15, 0.5, 0.2);
  assert.equal(p.sellingExVat, 30); // 15 / (1 − 0.5)
  assert.equal(p.rrpInclVat, 36);
});

test("freightBurden = total freight ÷ landed", () => {
  assert.equal(freightBurden(sku), 0.2308); // 3 / 13
});

test("ABC / XYZ classification", () => {
  assert.equal(classifyAbc(0.5), "A");
  assert.equal(classifyAbc(0.9), "B");
  assert.equal(classifyAbc(0.99), "C");
  assert.equal(classifyXyz(0.3), "X");
  assert.equal(classifyXyz(0.8), "Y");
  assert.equal(classifyXyz(1.5), "Z");
});

test("healthScore composes available factors and renormalises", () => {
  const h = healthScore({ gpPct: 0.4, targetGpPct: 0.5, freightBurden: 0.23, weeksCover: 8, sellThroughPct: 0.7, markdownPct: 0.05 });
  assert.ok(h.score > 0 && h.score <= 100);
  assert.ok(h.factors.length >= 5);
  // With no factors, score is null.
  assert.equal(healthScore({}).score, null);
});

test("healthBand maps score to a band", () => {
  assert.equal(healthBand(95).label, "Excellent");
  assert.equal(healthBand(71).label, "Monitor");
  assert.equal(healthBand(32).label, "Immediate review");
});

test("healthScore rewards on-target margin over weak margin", () => {
  const strong = healthScore({ gpPct: 0.6, targetGpPct: 0.5, freightBurden: 0.1, weeksCover: 8, sellThroughPct: 0.8 }).score;
  const weak = healthScore({ gpPct: 0.15, targetGpPct: 0.5, freightBurden: 0.4, weeksCover: 30, sellThroughPct: 0.2 }).score;
  assert.ok(strong > weak);
});

test("whatIf: an adverse FX move raises cost and cuts margin", () => {
  const base = marginAnalysis({ sellingExVat: 25, totalCost: computeCostBuild(sku).totalCost });
  const shocked = whatIf(sku, { fxTo: 8, sellingExVat: 25 });
  assert.equal(shocked.build.gbpFob, 11.25);   // 90 / 8
  assert.equal(shocked.build.totalCost, 16.25);
  assert.ok(shocked.margin.gpPct < base.gpPct); // margin compresses
});

test("whatIf: a freight increase flows through to landed + margin", () => {
  const shocked = whatIf(sku, { freightPct: 0.10, sellingExVat: 25 });
  assert.equal(shocked.build.freight, 3.3);   // 3 × 1.1
  assert.equal(shocked.build.totalCost, 15.3);
});

test("priceSku returns the whole view including a health score", () => {
  const v = priceSku(sku, { weeksCover: 8, sellThroughPct: 0.7, markdownPct: 0.05 });
  assert.equal(v.build.totalCost, 15);
  assert.equal(v.margin.gpPct, 0.4);
  assert.equal(v.freightBurden, 0.2308);
  assert.ok(v.health.score > 0);
  assert.ok(v.fxMarginSensitivity >= 0);
});

test("PRICING_CHANNELS are the two purchase channels", () => {
  assert.deepEqual(PRICING_CHANNELS, ["MINISO_MDS", "LOCAL_PURCHASE"]);
});
