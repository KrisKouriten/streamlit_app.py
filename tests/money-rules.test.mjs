import test from "node:test";
import assert from "node:assert/strict";
import { money, currencyPrefix, CCY_SYMBOL } from "../lib/money-rules.js";

// THE FAULT THIS PINS. money() hardcoded a £, and the facility register passed
// it USD payment amounts. Three November drawings totalling $512,293 rendered as
// £512,293, against a desk correctly showing £385,183, and the difference was
// investigated as an FX fault for hours. Nothing about any rate was wrong:
// $512,293 ÷ 1.33 IS £385,183. The currency symbol was the whole bug.

test("a foreign amount is never printed with a pound sign", () => {
  assert.equal(money(171259, { ccy: "USD" }), "$171,259");
  assert.equal(money(512293, { ccy: "USD" }), "$512,293");
  assert.equal(money(1000, { ccy: "EUR" }), "€1,000");
  assert.equal(money(1000, { ccy: "JPY" }), "¥1,000");
  // Lower case and padding are what a CSV actually delivers.
  assert.equal(money(1000, { ccy: "usd" }), "$1,000");
  assert.equal(money(1000, { ccy: " USD " }), "$1,000");
});

test("a currency with no symbol takes its ISO code rather than a wrong symbol", () => {
  // Uglier to read, impossible to misread — which is the trade this makes.
  assert.equal(money(512293, { ccy: "CNY" }), "CNY 512,293");
  assert.equal(money(1000, { ccy: "AED" }), "AED 1,000");
  assert.ok(!money(1000, { ccy: "CNY" }).includes("£"));
});

test("sterling is unchanged — house style stands", () => {
  assert.equal(money(1234567), "£1,234,567");
  assert.equal(money(1234567, { ccy: "GBP" }), "£1,234,567");
  assert.equal(money(385183), "£385,183");
  assert.equal(money(0), "£0");
  // Omitting ccy must keep meaning sterling: every existing caller relies on it.
  assert.equal(money(500, {}), "£500");
});

test("compact carries the currency too, so a tile cannot mislabel either", () => {
  assert.equal(money(1_500_000, { compact: true }), "£1.5m");
  assert.equal(money(1_500_000, { compact: true, ccy: "USD" }), "$1.5m");
  assert.equal(money(12_400, { compact: true, ccy: "USD" }), "$12k");
  assert.equal(money(12_400, { compact: true, ccy: "CNY" }), "CNY 12k");
});

test("negatives use a true minus, in any currency", () => {
  assert.equal(money(-1080685), "−£1,080,685");
  assert.equal(money(-500, { ccy: "USD" }), "−$500");
  assert.equal(money(-1_500_000, { compact: true, ccy: "USD" }), "−$1.5m");
});

test("nothing to show is a dash, not a zero", () => {
  // A dash means "no figure"; £0 means "nil". Conflating them is how an empty
  // feed passed for a month with no spend.
  for (const v of [null, undefined, "", NaN, "abc"]) {
    assert.equal(money(v), "—", `${String(v)} should render as a dash`);
    assert.equal(money(v, { ccy: "USD" }), "—");
  }
});

test("currencyPrefix defaults to sterling and never returns empty", () => {
  assert.equal(currencyPrefix(), "£");
  assert.equal(currencyPrefix(null), "£");
  assert.equal(currencyPrefix(""), "£");
  assert.equal(currencyPrefix("GBP"), "£");
  assert.equal(currencyPrefix("USD"), "$");
  assert.equal(CCY_SYMBOL.GBP, "£");
});
