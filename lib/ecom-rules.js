/*
 * E-COM reporting — pure rules, unit-tested in tests/ecom-rules.test.mjs.
 *
 * WHERE E-COM COMES FROM. The daily store sales sheet carries E-COM as one more
 * "store" line. It is not a store: it has no footfall door, no lease and no
 * till, and folding it into the store figures overstated company stores. So the
 * E-COM line is picked out by name (or an ECOMMERCE ownership type, if the store
 * master says so) and reported on its own — on the E-COM dashboard and the
 * HO-ECOM pages — and left out of the store dashboards.
 *
 * On the E-COM line the store columns mean:
 *   Net Sales          net sales
 *   No of Trans / Net  orders
 *   Net Units Sold     units
 *   Footfall In        sessions (site visits), where the sheet carries them
 *   Return Trans/Value returns
 *   Gross Profit       gross margin
 *
 * Fees and marketing are not in the daily sheet. They come from the monthly
 * management accounts for the E-Commerce entity (Joiin), grouped by
 * ecomPnlMonth below.
 */

// The E-COM line's name: "E-COM", "ECOM", "E-Commerce", "E Com Store",
// "Miniso E-COM"… The SQL twin (ECOM_NAME_SQL, Postgres regex) must agree.
export const ECOM_NAME_RE = /^\s*(miniso\s+)?e\s*-?\s*com(merce)?\b/i;
export const ECOM_NAME_SQL = "^\\s*(miniso\\s+)?e\\s*-?\\s*com(merce)?\\M";

export function isEcomStore(row = {}) {
  if (String(row.ownership_type || "").toUpperCase() === "ECOMMERCE") return true;
  return ECOM_NAME_RE.test(String(row.store_name || row.name || ""));
}

// The SQL predicate for the E-COM line, over core.dim_store aliased `st`.
export const ECOM_SQL = `(st.ownership_type = 'ECOMMERCE' OR COALESCE(st.store_name, '') ~* '${ECOM_NAME_SQL}')`;

const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const ratio = (a, b) => (num(b) ? num(a) / num(b) : null);
// Change as a fraction: (cy − py) / py, null when there is no base.
export const growth = (cy, py) => (num(py) ? (num(cy) - num(py)) / Math.abs(num(py)) : null);

/*
 * The KPIs for one set of totals:
 *   { net, gross, gm, orders, units, sessions, returnOrders, returnValue }
 * → { net, orders, aov, unitsPerOrder, conversion, marginPct, returnRate, returnValuePct, sessions }
 * Conversion needs sessions; null when the sheet carries none.
 */
export function ecomKpis(t = {}) {
  const net = num(t.net), orders = num(t.orders);
  return {
    net, orders, units: num(t.units), sessions: num(t.sessions) || null, gm: num(t.gm),
    aov: ratio(net, orders),
    unitsPerOrder: ratio(t.units, orders),
    conversion: num(t.sessions) ? orders / num(t.sessions) : null,
    marginPct: ratio(t.gm, net),
    returnRate: ratio(t.returnOrders, num(orders) + num(t.returnOrders)),
    returnValuePct: num(t.gross) ? Math.abs(num(t.returnValue)) / num(t.gross) : null,
  };
}

// A KPI against its comparator: { value, base, diff, pct }.
export function versus(value, base) {
  if (value == null || base == null) return { value, base, diff: null, pct: null };
  return { value, base, diff: value - base, pct: growth(value, base) };
}

/*
 * One month of the E-Commerce entity's P&L from the management accounts.
 *   rows  [{ section, account, value }] for the month (costs positive, as Joiin
 *         holds them)
 * → { sales, cogs, grossProfit, gmPct, fees, feesPct, marketing, marketingPct,
 *     roas, other, contribution, contributionPct, lines: { fees:[], marketing:[], other:[] } }
 *
 *   fees       payment and platform charges (PayPal, merchant, card, Stripe,
 *              Klarna, marketplace commission)
 *   marketing  advertising and marketing (paid social, search, influencers)
 *   other      every other cost, below the line items above
 *   roas       sales ÷ marketing — £ of sales per £1 of marketing
 *   contribution  gross profit − fees − marketing − other
 */
export const FEE_RE = /paypal|merchant|card (charge|fee)|stripe|klarna|clearpay|payment (fee|charge|processing)|transaction fee|commission|platform fee|marketplace/i;
export const MARKETING_RE = /advertis|marketing|promotion|influencer|ppc|pay per click|google ads|facebook|meta ads|tiktok ads|affiliate|sponsor/i;

export function ecomPnlMonth(rows = []) {
  const out = { sales: 0, cogs: 0, fees: 0, marketing: 0, other: 0, lines: { fees: {}, marketing: {}, other: {} } };
  const add = (bucket, account, v) => { out[bucket] += v; out.lines[bucket][account] = (out.lines[bucket][account] || 0) + v; };
  for (const r of rows || []) {
    const v = num(r.value);
    const section = String(r.section || "");
    const account = String(r.account || "");
    if (section === "Revenue") out.sales += v;
    else if (section === "Other Income") out.sales += 0;          // not trading income
    else if (section === "Cost of Sales") {
      // Payment charges sometimes sit in cost of sales; they are still fees.
      if (FEE_RE.test(account)) add("fees", account, v); else out.cogs += v;
    } else if (section === "Expenses" || section === "Other Expenses") {
      if (FEE_RE.test(account)) add("fees", account, v);
      else if (MARKETING_RE.test(account)) add("marketing", account, v);
      else add("other", account, v);
    }
  }
  const grossProfit = out.sales - out.cogs;
  const contribution = grossProfit - out.fees - out.marketing - out.other;
  const pctOf = (v) => (out.sales ? v / out.sales : null);
  const toList = (o) => Object.entries(o).map(([account, value]) => ({ account, value })).sort((a, b) => b.value - a.value);
  return {
    sales: out.sales, cogs: out.cogs, grossProfit, gmPct: pctOf(grossProfit),
    fees: out.fees, feesPct: pctOf(out.fees),
    marketing: out.marketing, marketingPct: pctOf(out.marketing),
    roas: out.marketing ? out.sales / out.marketing : null,
    other: out.other, contribution, contributionPct: pctOf(contribution),
    lines: { fees: toList(out.lines.fees), marketing: toList(out.lines.marketing), other: toList(out.lines.other) },
  };
}

// Months 'YYYY-MM' of a calendar year, January first.
export const monthsOfYear = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
