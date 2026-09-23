import test from "node:test";
import assert from "node:assert/strict";
import {
  VAT_STANDARD, VAT_TREATMENTS, defaultVatRate, validVatRate, vatRateOf,
  netOf, grossOf, vatOf, grossFromNet, netFromGross, vatLabel,
} from "../lib/vat-rules.js";

/*
 * The procurement budget is a cash-out plan, and what leaves the bank is the
 * GROSS invoice — we pay the supplier VAT and reclaim it from HMRC later, on a
 * different timetable. The requests were a mix of net and gross with nothing
 * recording which, so a month's committed figure was part one and part the
 * other. `amount_gbp` keeps meaning NET; gross is derived.
 */

test("Local and Merch default to the standard rate; Miniso to none", () => {
  assert.equal(VAT_STANDARD, 0.2);
  assert.equal(defaultVatRate({ source: "LOCAL" }), 0.2);
  assert.equal(defaultVatRate({ source: "MERCH" }), 0.2);
  assert.equal(defaultVatRate({ channel_code: "RETAIL" }), 0.2);
  assert.equal(defaultVatRate({}), 0.2);
  // Miniso is an import: VAT is paid to HMRC at the border, not to the
  // supplier, so grossing it up would make its committed value disagree with
  // the letter of credit the bank actually draws.
  assert.equal(defaultVatRate({ source: "MINISO" }), 0);
  assert.equal(defaultVatRate({ source: "miniso" }), 0);
});

test("an explicit rate beats the default, including an explicit zero", () => {
  // `0` is a real answer — zero-rated, or exempt — and must not fall through to
  // the 20% default the way a plain `||` would have let it.
  assert.equal(vatRateOf({ source: "LOCAL", vat_rate: 0 }), 0);
  assert.equal(vatRateOf({ source: "LOCAL", vat_rate: "0" }), 0);
  assert.equal(vatRateOf({ source: "MINISO", vat_rate: 0.2 }), 0.2);
  assert.equal(vatRateOf({ source: "LOCAL", vat_rate: 0.05 }), 0.05);
  // Not stated at all → the source default.
  assert.equal(vatRateOf({ source: "LOCAL" }), 0.2);
  assert.equal(vatRateOf({ source: "LOCAL", vat_rate: null }), 0.2);
});

test("an unusable rate falls back rather than producing a figure nobody can explain", () => {
  assert.equal(validVatRate(0.2), 0.2);
  assert.equal(validVatRate(0), 0);
  assert.equal(validVatRate(1), 1);
  // 20 is a percentage typed as a whole number — grossing by 2000% would be a
  // very loud wrong answer, but a wrong answer nonetheless.
  assert.equal(validVatRate(20), null);
  assert.equal(validVatRate(-0.2), null);
  assert.equal(validVatRate("abc"), null);
  assert.equal(validVatRate(null), null);
  assert.equal(validVatRate(undefined), null);
  assert.equal(validVatRate(NaN), null);
  assert.equal(validVatRate(Infinity), null);
  // And the fallback is the source default, not zero.
  assert.equal(vatRateOf({ source: "LOCAL", vat_rate: 20 }), 0.2);
});

test("net, gross and VAT are consistent", () => {
  const local = { source: "LOCAL", amount_gbp: 1000 };
  assert.equal(netOf(local), 1000);
  assert.equal(grossOf(local), 1200);
  assert.equal(vatOf(local), 200);
  assert.equal(grossOf(local) - netOf(local), vatOf(local));

  const miniso = { source: "MINISO", amount_gbp: 1000 };
  assert.equal(grossOf(miniso), 1000);
  assert.equal(vatOf(miniso), 0);
});

test("grossing rounds to the penny, not to something that will not add up", () => {
  // A real Local row from the September extract.
  assert.equal(grossOf({ source: "LOCAL", amount_gbp: 911.88 }), 1094.26);
  assert.equal(grossOf({ source: "LOCAL", amount_gbp: 1175.40 }), 1410.48);
  assert.equal(grossOf({ source: "LOCAL", amount_gbp: 1793.57 }), 2152.28);
  assert.equal(grossOf({ source: "LOCAL", amount_gbp: 0.01 }), 0.01);
  assert.equal(grossOf({ source: "LOCAL", amount_gbp: 0 }), 0);
});

test("a missing or unreadable amount is nil, not NaN", () => {
  // NaN propagates silently through a rollup and turns a month's total into
  // nothing at all, which reads identically to "no orders".
  for (const v of [null, undefined, "", "abc", NaN]) {
    assert.equal(netOf({ source: "LOCAL", amount_gbp: v }), 0, String(v));
    assert.equal(grossOf({ source: "LOCAL", amount_gbp: v }), 0, String(v));
    assert.equal(vatOf({ source: "LOCAL", amount_gbp: v }), 0, String(v));
  }
  assert.equal(grossOf({}), 0);
  assert.equal(grossOf(), 0);
});

test("grossOf can read any net field, so an invoice grosses the same way", () => {
  const row = { source: "LOCAL", amount_gbp: 1000, invoice_amount: 880, landed_cost: 1200 };
  assert.equal(grossOf(row), 1200);                       // amount_gbp by default
  assert.equal(grossOf(row, "invoice_amount"), 1056);
  assert.equal(grossOf(row, "landed_cost"), 1440);
});

test("net → gross → net round-trips", () => {
  for (const n of [911.88, 1000, 42089.67, 0.5]) {
    assert.equal(netFromGross(grossFromNet(n), VAT_STANDARD), n, `£${n}`);
  }
  assert.equal(grossFromNet(1000, 0), 1000);
  assert.equal(netFromGross(1000, 0), 1000);
});

test("the form shows nothing until there is something to show", () => {
  // Null, not £0.00 — an empty field should look empty rather than like a
  // deliberate zero.
  assert.equal(grossFromNet(""), null);
  assert.equal(grossFromNet(null), null);
  assert.equal(grossFromNet(undefined), null);
  assert.equal(grossFromNet("abc"), null);
  assert.equal(grossFromNet(1000, 20), null);             // unusable rate
  assert.equal(netFromGross("", 0.2), null);
});

test("vatLabel says the basis in one phrase", () => {
  assert.equal(vatLabel({ source: "LOCAL" }), "VAT 20%");
  assert.equal(vatLabel({ source: "MINISO" }), "no VAT");
  assert.equal(vatLabel({ source: "LOCAL", vat_rate: 0 }), "no VAT");
  assert.equal(vatLabel({ source: "LOCAL", vat_rate: 0.05 }), "VAT 5%");
});

test("the two treatments Merch picks between are the two real answers", () => {
  assert.deepEqual(VAT_TREATMENTS.map((t) => t.rate), [0.2, 0]);
  for (const t of VAT_TREATMENTS) {
    assert.equal(validVatRate(t.rate), t.rate);
    assert.ok(t.label && t.hint);
  }
});
