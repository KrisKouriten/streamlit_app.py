import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultVatRate, vatRateOf, netVat, vatEntryError } from "../lib/vat-rules.js";
import { rechargeLineAmounts } from "../lib/intercompany-rules.js";
import { committedAmountGross, committedAmount } from "../lib/procurement-close-rules.js";

// Budgets are ex-VAT: an invoice is keyed net + VAT, and only the net is ever
// compared with a budget. These pin that down.

test("netVat: the gross is net plus the VAT keyed, the net is unchanged", () => {
  assert.deepEqual(netVat(1000, 200), { net: 1000, vat: 200, gross: 1200, rate: 0.2 });
  assert.deepEqual(netVat("1,000.00", "£200"), { net: 1000, vat: 200, gross: 1200, rate: 0.2 });
  assert.deepEqual(netVat(500, 0), { net: 500, vat: 0, gross: 500, rate: 0 });
});

test("netVat: no VAT keyed is 'not recorded', and the gross is the net", () => {
  const r = netVat(500, "");
  assert.equal(r.vat, null);
  assert.equal(r.gross, 500);
  assert.equal(r.rate, null);
  assert.equal(netVat(500, null).vat, null);
});

test("vatEntryError: refuses negative VAT and VAT over 20% of the net", () => {
  assert.equal(vatEntryError(1000, 200), null);
  assert.equal(vatEntryError(1000, 50), null);       // a part-rated invoice
  assert.equal(vatEntryError(1000, ""), null);       // not recorded
  assert.equal(vatEntryError(1000, 0), null);
  assert.match(vatEntryError(1000, -1), /negative/);
  assert.match(vatEntryError(1000, 1200), /more than 20%/);   // the gross typed into the VAT box
  assert.equal(vatEntryError(99.99, 20), null);      // rounding on the invoice
});

test("defaultVatRate: a Local order in a foreign currency carries no UK VAT", () => {
  assert.equal(defaultVatRate({ source: "LOCAL", currency: "USD" }), 0);
  assert.equal(defaultVatRate({ source: "LOCAL", currency: "EUR" }), 0);
  assert.equal(defaultVatRate({ source: "LOCAL", currency: "GBP" }), 0.2);
  assert.equal(defaultVatRate({ source: "LOCAL" }), 0.2);
  assert.equal(defaultVatRate({ source: "MINISO", currency: "GBP" }), 0);
  // An explicit rate on the row still wins.
  assert.equal(vatRateOf({ source: "LOCAL", currency: "USD", vat_rate: 0.2 }), 0.2);
});

test("recharge: each store takes its share of the invoice net and of its VAT", () => {
  const po = { invoice_amount: 1000, payment_value: 1100 };
  const inv = [{ invoice_amount: 600, vat_amount: 120 }, { invoice_amount: 400, vat_amount: 80 }];
  assert.deepEqual(rechargeLineAmounts(25, po, inv), { net: 250, vat: 50, gross: 300 });
});

test("recharge: no invoice VAT recorded leaves VAT unknown, gross = net", () => {
  const po = { invoice_amount: 1000 };
  assert.deepEqual(rechargeLineAmounts(50, po, [{ invoice_amount: 1000, vat_amount: null }]), { net: 500, vat: null, gross: 500 });
  // Not invoiced: the P.O value (net), no VAT known.
  assert.deepEqual(rechargeLineAmounts(50, { payment_value: 800 }, []), { net: 400, vat: null, gross: 400 });
});

test("procurement: committed stays the invoice net; the gross uses the invoice's own VAT", () => {
  const row = { amount_gbp: 1000, invoice_amount: 950, invoice_vat: 150, vat_rate: 0.2 };
  assert.equal(committedAmount(row), 950);
  assert.equal(committedAmountGross(row), 1100);
  // No VAT keyed: worked out at the row's rate, as before.
  assert.equal(committedAmountGross({ amount_gbp: 1000, invoice_amount: 950, vat_rate: 0.2 }), 1140);
});
