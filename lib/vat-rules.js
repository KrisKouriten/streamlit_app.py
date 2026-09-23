/*
 * VAT on a procurement request — pure, unit-testable.
 *
 * WHY THIS EXISTS. The procurement budget is a cash-out plan, and what actually
 * leaves the bank is the GROSS invoice: we pay the supplier VAT and reclaim it
 * from HMRC later, on a different timetable. The requests, though, were a mix —
 * Merch entered whatever was on the quote — so a month's committed figure was
 * part net and part gross with nothing recording which.
 *
 * So a request now carries its VAT rate, and every figure derives from two
 * knowns: the net amount Merch entered, and that rate.
 *
 *   net    what Merch enters — the value on the quote
 *   gross  net x (1 + rate) — the cash that leaves
 *   vat    the difference
 *
 * `amount_gbp` keeps meaning NET. It is what Merch types, what every existing
 * row holds, and changing its meaning would silently restate history rather
 * than explain it.
 *
 * MINISO IS DIFFERENT, and defaults to no VAT. Import VAT on HQ stock is paid to
 * HMRC at the border, not to the supplier, so it is not part of what the letter
 * of credit or the facility pays. Grossing a Miniso order up by 20% would make
 * its committed value disagree with the LC the bank actually draws.
 */

// The UK standard rate. A rate, not a flag, so a change of rate — or a reduced
// rate on a specific category — is data rather than a deploy.
export const VAT_STANDARD = 0.2;

// What Merch picks between on the raise form. Free-text rates are deliberately
// not offered: the two real answers are "standard rated" and "not".
export const VAT_TREATMENTS = [
  { rate: VAT_STANDARD, label: "VAT 20%", hint: "standard rated — gross is net plus 20%" },
  { rate: 0, label: "No VAT", hint: "zero-rated, exempt, or VAT paid at the border" },
];

/*
 * The rate a row uses when it has not been told one.
 *
 * Existing rows carry no rate, so the default decides what they are worth. Local
 * and Merchandising buy from UK suppliers who charge VAT, so 20% is right for
 * them. Miniso is an import: see above.
 */
export function defaultVatRate(row = {}) {
  return String(row.source || "").toUpperCase() === "MINISO" ? 0 : VAT_STANDARD;
}

/*
 * A number, strictly.
 *
 * Number(null), Number(undefined) and Number("") are all 0 in JavaScript, and 0
 * is a meaningful VAT rate — so the loose coercion would turn "not stated" into
 * "zero-rated" and quietly drop the 20% default. The same trap made an empty
 * form field render £0.00 instead of nothing.
 */
function strictNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A rate is usable if it is a number from 0 to 1. Anything else — a percentage
// typed as 20, a negative, a string, or nothing at all — falls back rather than
// producing a figure nobody can explain.
export function validVatRate(rate) {
  const n = strictNum(rate);
  return n != null && n >= 0 && n <= 1 ? n : null;
}

export function vatRateOf(row = {}) {
  const explicit = row.vat_rate == null ? null : validVatRate(row.vat_rate);
  return explicit == null ? defaultVatRate(row) : explicit;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The net amount — what Merch entered. `amount_gbp` has always meant this.
export function netOf(row = {}, field = "amount_gbp") {
  return strictNum(row?.[field]) ?? 0;
}

// The cash that leaves. Net plus VAT at the row's rate.
export function grossOf(row = {}, field = "amount_gbp") {
  return round2(netOf(row, field) * (1 + vatRateOf(row)));
}

export function vatOf(row = {}, field = "amount_gbp") {
  return round2(grossOf(row, field) - netOf(row, field));
}

// Net → gross for a form, where the amount is being typed rather than read off a
// row. Null when there is nothing to work from, so the field can stay empty
// instead of showing £0.00 before anything is entered.
export function grossFromNet(net, rate = VAT_STANDARD) {
  const n = strictNum(net);
  const r = validVatRate(rate);
  if (n == null || r == null) return null;
  return round2(n * (1 + r));
}

// Gross → net, for when the gross is the figure in hand (an invoice, typically)
// and the net has to be worked back out.
export function netFromGross(gross, rate = VAT_STANDARD) {
  const g = strictNum(gross);
  const r = validVatRate(rate);
  if (g == null || r == null) return null;
  return round2(g / (1 + r));
}

// How to describe a row's basis in one phrase, for a column note or a tooltip.
export function vatLabel(row = {}) {
  const r = vatRateOf(row);
  if (!r) return "no VAT";
  return `VAT ${Number((r * 100).toFixed(2))}%`;
}
