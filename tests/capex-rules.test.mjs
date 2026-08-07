import { test } from "node:test";
import assert from "node:assert/strict";
import {
  totalInvestment, npv, irr, payback, roce, projectModel, portfolio, capitalAllocation, clearsHurdle,
  INVESTMENT_TYPES, INVESTMENT_COMPONENTS,
} from "../lib/capex-rules.js";

test("totalInvestment sums the components", () => {
  assert.equal(totalInvestment({ fit_out: 300000, fixtures: 100000, it: 50000, inventory: 40000, contingency: 10000 }), 500000);
});

test("npv discounts a cashflow series", () => {
  // -1000 + 500/1.1 + 500/1.21 + 500/1.331 = 243.43
  assert.equal(npv(0.1, [-1000, 500, 500, 500]), 243.43);
});

test("irr solves the rate that zeroes NPV", () => {
  const r = irr([-1000, 500, 500, 500]);
  assert.ok(Math.abs(r - 0.2337) < 0.001, `irr ${r}`);
  // A series with no sign change has no IRR.
  assert.equal(irr([100, 100, 100]), null);
});

test("payback interpolates within the recovery year", () => {
  assert.equal(payback([-1000, 500, 500, 500]), 2.0);
  assert.equal(payback([-1000, 400, 400, 400, 400]), 2.5);
  assert.equal(payback([-1000, 100, 100]), null); // never recovers
});

test("roce = EBIT / capital employed", () => {
  assert.equal(roce(150000, 500000), 0.3);
  assert.equal(roce(100, 0), null);
});

test("projectModel builds the P&L → EBITDA → FCF chain", () => {
  const m = projectModel({
    investment: { fit_out: 500000 }, year1_revenue: 1000000, revenue_growth_pct: 0.05,
    gross_margin_pct: 0.6, payroll_pct: 0.2, opex_pct: 0.15, depreciation_years: 5, tax_rate: 0.25, discount_rate: 0.1, years: 10,
  });
  assert.equal(m.totalInvestment, 500000);
  const y1 = m.rows[0];
  assert.equal(y1.revenue, 1000000);
  assert.equal(y1.ebitda, 250000);       // 600k GP − 200k payroll − 150k opex
  assert.equal(y1.ebitdaMargin, 0.25);
  assert.equal(y1.depreciation, 100000);  // 500k / 5
  assert.equal(y1.ebit, 150000);
  assert.equal(y1.tax, 37500);            // 150k × 25%
  assert.equal(y1.fcf, 212500);           // ebitda − tax
  assert.equal(m.fcfSeries[0], -500000);
  assert.ok(m.summary.irr > 0.3, `irr ${m.summary.irr}`);
  assert.ok(m.summary.npv > 0);
  assert.ok(m.summary.payback != null && m.summary.payback < 4);
});

test("portfolio consolidates project models", () => {
  const one = projectModel({ investment: { fit_out: 500000 }, year1_revenue: 1000000, gross_margin_pct: 0.6, payroll_pct: 0.2, opex_pct: 0.15, tax_rate: 0.25, years: 8 });
  const p = portfolio([one, one], { discountRate: 0.1 });
  assert.equal(p.projects, 2);
  assert.equal(p.totalInvestment, 1000000);
  assert.equal(p.avgIrr, one.summary.irr);       // two identical projects
  assert.ok(Math.abs(p.npv - 2 * one.summary.npv) < 1); // combined ≈ 2×
});

test("capitalAllocation computes remaining + funding required", () => {
  const alloc = capitalAllocation({ capitalAvailable: 18600000, committed: 8900000, cashAvailable: 11200000 }, { projects: 12, avgIrr: 0.27, avgPayback: 2.8 });
  assert.equal(alloc.remaining, 9700000);
  assert.equal(alloc.fundingRequired, 0);  // cash 11.2m > committed 8.9m
  assert.equal(alloc.avgIrr, 0.27);
});

test("clearsHurdle compares IRR to the hurdle rate", () => {
  assert.equal(clearsHurdle({ irr: 0.27 }, 0.15), true);
  assert.equal(clearsHurdle({ irr: 0.1 }, 0.15), false);
  assert.equal(clearsHurdle({ irr: null }, 0.15), null);
});

test("vocab constants", () => {
  assert.ok(INVESTMENT_TYPES.includes("NEW_STORE"));
  assert.equal(INVESTMENT_COMPONENTS.length, 12);
  assert.ok(["rent", "business_rates", "service_charge"].every((k) => INVESTMENT_COMPONENTS.includes(k)));
});

test("occupancy costs count as investment but are excluded from depreciation", () => {
  const inv = { fit_out: 100000, rent: 20000, business_rates: 5000, service_charge: 3000 };
  assert.equal(totalInvestment(inv), 128000);
  // depreciable base excludes rent / business rates / service charge (and inventory + working capital)
  const m = projectModel({ investment: inv, year1_revenue: 0, gross_margin_pct: 0, depreciation_years: 4, years: 4 });
  // depreciable = 100,000 (fit-out only) over 4 years → 25,000/yr; occupancy excluded
  assert.equal(m.rows[0].depreciation, 25000);
});
