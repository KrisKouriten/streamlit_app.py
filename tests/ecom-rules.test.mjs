import { test } from "node:test";
import assert from "node:assert/strict";
import { isEcomStore, ECOM_NAME_RE, ecomKpis, growth, versus, ecomPnlMonth, ECOM_SQL, monthsOfYear } from "../lib/ecom-rules.js";

test("the E-COM line is picked out of the store sheet by name or ownership", () => {
  for (const name of ["E-COM", "ECOM", "E-Com", "E Com Store", "E-Commerce", "Ecommerce", "Miniso E-COM", " e-com "]) {
    assert.equal(isEcomStore({ store_name: name }), true, name);
  }
  for (const name of ["Ealing", "Eastbourne", "Economy Outlet", "Edinburgh", "Westfield E-City", "Leeds"]) {
    assert.equal(isEcomStore({ store_name: name }), false, name);
  }
  assert.equal(isEcomStore({ store_name: "Online", ownership_type: "ECOMMERCE" }), true);
  assert.ok(ECOM_NAME_RE instanceof RegExp);
  assert.match(ECOM_SQL, /ownership_type = 'ECOMMERCE'/);
});

test("KPIs: AOV, units per order, conversion, margin and returns", () => {
  const k = ecomKpis({ net: 10000, gross: 11000, gm: 4500, orders: 250, units: 600, sessions: 12500, returnOrders: 10, returnValue: -550 });
  assert.equal(k.aov, 40);
  assert.equal(k.unitsPerOrder, 2.4);
  assert.equal(k.conversion, 0.02);
  assert.equal(k.marginPct, 0.45);
  assert.equal(Math.round(k.returnRate * 10000) / 10000, Math.round((10 / 260) * 10000) / 10000);
  assert.equal(k.returnValuePct, 0.05);
  // No sessions in the sheet: conversion unknown, not zero.
  assert.equal(ecomKpis({ net: 100, orders: 2 }).conversion, null);
  assert.equal(ecomKpis({ net: 0, orders: 0 }).aov, null);
});

test("growth and versus", () => {
  assert.equal(growth(110, 100), 0.1);
  assert.equal(growth(5, 0), null);
  assert.deepEqual(versus(120, 100), { value: 120, base: 100, diff: 20, pct: 0.2 });
  assert.equal(versus(120, null).pct, null);
});

test("management accounts month: fees and marketing pulled out of costs", () => {
  const m = ecomPnlMonth([
    { section: "Revenue", account: "ST: Sales", value: 84823 },
    { section: "Cost of Sales", account: "ST: Cost of Goods Sold", value: 40000 },
    { section: "Cost of Sales", account: "ST: PayPal Fees", value: 1200 },
    { section: "Expenses", account: "ST: Merchant Charges", value: 800 },
    { section: "Expenses", account: "ST: Advertising & Marketing", value: 8000 },
    { section: "Expenses", account: "ST: Wages", value: 5000 },
  ]);
  assert.equal(m.sales, 84823);
  assert.equal(m.cogs, 40000);
  assert.equal(m.grossProfit, 44823);
  assert.equal(m.fees, 2000);
  assert.equal(m.marketing, 8000);
  assert.equal(m.other, 5000);
  assert.equal(m.contribution, 44823 - 2000 - 8000 - 5000);
  assert.equal(Math.round(m.roas * 100) / 100, Math.round((84823 / 8000) * 100) / 100);
  assert.deepEqual(m.lines.fees.map((l) => l.account), ["ST: PayPal Fees", "ST: Merchant Charges"]);
  assert.equal(ecomPnlMonth([]).roas, null);
  assert.equal(monthsOfYear(2026).length, 12);
});
