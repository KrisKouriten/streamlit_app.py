/*
 * FX — pure, unit-testable. Miniso procurement is raised in USD; Finance holds
 * three USD→GBP rates and converts at one of them. Rates are quoted the way a UK
 * treasurer reads GBPUSD: foreign units per £1 (e.g. 1.2700 = £1 buys $1.27), so
 *   GBP = amount_in_ccy ÷ rate.
 * On approval two rates are chosen: the actual-cost rate settles the cashflow
 * (what we pay), the stock rate values the goods on arrival (closing stock); the
 * difference between the two GBP figures is the FX gain/loss on the P&L.
 */

// The three rate types, in the order Finance thinks about them.
export const FX_RATE_TYPES = [
  { key: "SPOT", label: "Spot rate", hint: "the rate paid at the point in time" },
  { key: "HEDGED", label: "Hedged rate", hint: "the rate locked in when hedging with HSBC" },
  { key: "COSTING", label: "Costing rate", hint: "the rate stock is valued at" },
];
export const FX_RATE_TYPE_KEYS = FX_RATE_TYPES.map((t) => t.key);
export const FX_RATE_LABEL = Object.fromEntries(FX_RATE_TYPES.map((t) => [t.key, t.label]));

// Currencies we convert against GBP. USD only for now; GBP itself is a no-op.
export const FX_CURRENCIES = ["USD"];
export const isForeignCurrency = (ccy) => FX_CURRENCIES.includes(String(ccy || "").toUpperCase());

// A rate is usable only if it is a finite positive number.
export function validRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Convert a foreign-currency amount to GBP at a GBPccy rate (foreign per £1).
// Returns null when the amount or rate can't be used.
export function convertToGbp(amount, rate) {
  const a = Number(amount);
  const r = validRate(rate);
  if (!Number.isFinite(a) || r == null) return null;
  return a / r;
}

// GBP amount for a purchase in `currency` holding `amount` at the given rate. A
// GBP order passes straight through (rate irrelevant).
export function amountToGbp(amount, currency, rate) {
  if (!isForeignCurrency(currency)) return Number(amount);
  return convertToGbp(amount, rate);
}

// Look a rate up in a getFxRates() list ([{currency, rate_type, rate}]).
export function findRate(rates, currency, rateType) {
  const ccy = String(currency || "").toUpperCase();
  const rt = String(rateType || "").toUpperCase();
  const hit = (rates || []).find((r) => String(r.currency).toUpperCase() === ccy && String(r.rate_type).toUpperCase() === rt);
  return hit ? validRate(hit.rate) : null;
}

// The FX gain/loss booked to P&L: what we value stock at on arrival minus what
// we actually pay in cashflow. +ve = stock valued above cash cost (favourable).
export function fxVariance(stockValueGbp, cashflowGbp) {
  if (stockValueGbp == null || cashflowGbp == null) return null;
  const s = Number(stockValueGbp), c = Number(cashflowGbp);
  if (!Number.isFinite(s) || !Number.isFinite(c)) return null;
  return s - c;
}

// Resolve the GBP cashflow + stock valuation for an approval, given the order
// currency, original-currency amount, chosen rate types and the rate table.
// GBP orders return the amount unchanged with no FX detail.
export function resolveApprovalFx({ currency, amountCcy, costRateType, stockRateType, rates }) {
  if (!isForeignCurrency(currency)) {
    const gbp = Number(amountCcy);
    return { foreign: false, cashflowGbp: Number.isFinite(gbp) ? gbp : null };
  }
  const costRate = findRate(rates, currency, costRateType);
  const stockRate = findRate(rates, currency, stockRateType);
  const cashflowGbp = convertToGbp(amountCcy, costRate);
  const stockValueGbp = convertToGbp(amountCcy, stockRate);
  return {
    foreign: true,
    costRate, stockRate,
    cashflowGbp, stockValueGbp,
    fxVariance: fxVariance(stockValueGbp, cashflowGbp),
  };
}
