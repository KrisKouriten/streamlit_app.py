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

/*
 * Currencies. Anything that is not sterling is foreign and needs a rate.
 *
 * This used to be a hard-coded ["USD"], which meant a EUR or CNY drawing could
 * not be given a rate at all — and `isForeignCurrency` answered false for it, so
 * it passed through as though it were already sterling. That is silent, and the
 * wrong direction to fail in: an unrecognised currency should be visible, not
 * treated as pounds.
 *
 * The rate table has always keyed on (currency, rate_type), so it generalised
 * from the start; only the code held it to one currency.
 */
export const GBP = "GBP";
export const normaliseCcy = (ccy) => String(ccy || "").trim().toUpperCase();
export const isForeignCurrency = (ccy) => {
  const c = normaliseCcy(ccy);
  return !!c && c !== GBP;
};
// A currency code we will accept onto the rate table: three letters, not GBP.
// Deliberately not an allow-list of the world's currencies — a code the business
// starts trading in should not need a deploy.
export const isValidCcyCode = (ccy) => /^[A-Z]{3}$/.test(normaliseCcy(ccy)) && normaliseCcy(ccy) !== GBP;

// Offered in the "add a currency" picker. A convenience, not a limit: anything
// matching isValidCcyCode can be typed in.
export const FX_CURRENCY_SUGGESTIONS = [
  ["USD", "US dollar"], ["EUR", "Euro"], ["CNY", "Chinese yuan"], ["HKD", "Hong Kong dollar"],
  ["JPY", "Japanese yen"], ["KRW", "South Korean won"], ["SGD", "Singapore dollar"],
  ["TWD", "New Taiwan dollar"], ["VND", "Vietnamese dong"], ["THB", "Thai baht"],
  ["INR", "Indian rupee"], ["AUD", "Australian dollar"], ["CAD", "Canadian dollar"],
  ["CHF", "Swiss franc"], ["SEK", "Swedish krona"], ["NOK", "Norwegian krone"],
  ["DKK", "Danish krone"], ["PLN", "Polish zloty"], ["AED", "UAE dirham"],
  ["NZD", "New Zealand dollar"], ["ZAR", "South African rand"], ["TRY", "Turkish lira"],
];

// Kept for callers that still import it — the currencies with a rate ON RECORD is
// now a question for the rate table, not a constant.
export const FX_CURRENCIES = FX_CURRENCY_SUGGESTIONS.map(([c]) => c);

// The distinct currencies present in a getFxRates() list, in display order.
export function currenciesInRates(rates = []) {
  const seen = [];
  for (const r of rates || []) {
    const c = normaliseCcy(r.currency);
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen.sort();
}

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
