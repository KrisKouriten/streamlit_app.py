/*
 * Formatting an amount of money — pure, so it can be tested.
 *
 * Lifted out of app/finance-os/ui.js, which imports next/link and so cannot be
 * loaded by the test runner. It was worth moving: the bug that lived here was
 * expensive and completely invisible.
 *
 * THE BUG. money() hardcoded a £. The facility register passed it USD payment
 * amounts, with the currency sitting in the next column along. Three November
 * drawings — $171,259 + $168,776 + $172,258 = $512,293 — rendered as £512,293.
 * The procurement desk showed £385,183 for the same month and the difference was
 * chased as an FX fault for hours. No rate was ever wrong: $512,293 ÷ 1.33 IS
 * £385,183. The only wrong thing on any screen was the currency symbol.
 *
 * House style is £ with comma thousands (£1,234,567); £m to one decimal and £k
 * for headline tiles. That is unchanged for sterling. A foreign amount is simply
 * never printed with a £ any more.
 */

// Symbols only where they are unambiguous to a UK reader. Everything else takes
// its ISO code — uglier, and impossible to misread, which is the trade this
// whole module exists to make.
export const CCY_SYMBOL = { GBP: "£", USD: "$", EUR: "€", JPY: "¥" };

export function currencyPrefix(ccy) {
  const code = String(ccy || "GBP").toUpperCase().trim() || "GBP";
  return CCY_SYMBOL[code] || `${code} `;
}

export function money(n, { compact = false, ccy = "GBP" } = {}) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const sym = currencyPrefix(ccy);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}m`;
    if (abs >= 1_000) return `${sign}${sym}${Math.round(abs / 1000).toLocaleString("en-GB")}k`;
  }
  return `${sign}${sym}${Math.round(abs).toLocaleString("en-GB")}`;
}
