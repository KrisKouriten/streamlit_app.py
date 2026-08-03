/*
 * Treasury — pure rules (no imports, no DB). Summarises the five Treasury registers:
 * the bank trade facility (HSBC TradePay + post-shipment buyer loans), the bank term
 * loan register, FX hedging contracts, the sales income streams and store cash
 * reconciliations. All aggregation lives here so it is unit-tested independently of
 * the database and UI. Unit-tested in tests/treasury-rules.test.mjs.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;

// ---- Bank trade facility ----
export const SALES_STREAMS = [
  { code: "RETAIL", label: "Retail sales" },
  { code: "WHOLESALE", label: "Wholesale sales" },
  { code: "FRANCHISE", label: "Franchise income" },
];
export const isSalesStream = (c) => SALES_STREAMS.some((s) => s.code === c);

const monthOf = (d) => (d ? String(d).slice(0, 7) : null);

// Roll the facility drawings into totals + breakdowns. The GBP cash-out is
// facility_payment_gbp; drawings settle in payment_month. Returns the settlement
// calendar (by month), the split by cost driver, product type and currency.
export function facilitySummary(rows = []) {
  const drawings = rows.length;
  const totalGbp = round2(rows.reduce((t, r) => t + num(r.facility_payment_gbp), 0));
  const outstandingGbp = round2(rows.filter((r) => r.status !== "Settled").reduce((t, r) => t + num(r.facility_payment_gbp), 0));
  const bucket = (key) => {
    const m = {};
    for (const r of rows) { const k = r[key] || "—"; m[k] = round2((m[k] || 0) + num(r.facility_payment_gbp)); }
    return Object.entries(m).map(([k, v]) => ({ key: k, gbp: v })).sort((a, b) => b.gbp - a.gbp);
  };
  const byMonthMap = {};
  for (const r of rows) {
    const m = monthOf(r.payment_month) || "—";
    byMonthMap[m] = byMonthMap[m] || { month: m, gbp: 0, count: 0 };
    byMonthMap[m].gbp = round2(byMonthMap[m].gbp + num(r.facility_payment_gbp));
    byMonthMap[m].count += 1;
  }
  const byMonth = Object.values(byMonthMap).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  return {
    drawings, totalGbp, outstandingGbp,
    byCostDriver: bucket("cost_driver"),
    byProduct: bucket("product_type"),
    byCurrency: bucket("payment_currency"),
    byMonth,
    peakMonth: byMonth.reduce((p, m) => (m.gbp > (p?.gbp || 0) ? m : p), null),
  };
}

// ---- Bank term loans ----
export function termLoanSummary(loans = []) {
  const principal = round2(loans.reduce((t, l) => t + num(l.principal_gbp), 0));
  const balance = round2(loans.reduce((t, l) => t + num(l.balance_gbp), 0));
  // Balance-weighted average interest rate.
  const wRate = balance > 0 ? round2(loans.reduce((t, l) => t + num(l.balance_gbp) * num(l.interest_rate), 0) / balance) : 0;
  return { count: loans.length, principal, balance, weightedRate: wRate };
}

// ---- Hedging ----
export function hedgingSummary(contracts = []) {
  const open = contracts.filter((c) => (c.status || "OPEN") === "OPEN");
  const notionalByPair = {};
  for (const c of open) { const k = c.pair || "—"; notionalByPair[k] = round2((notionalByPair[k] || 0) + num(c.notional)); }
  return {
    count: contracts.length,
    openCount: open.length,
    netMtmGbp: round2(contracts.reduce((t, c) => t + num(c.mtm_gbp), 0)),
    byPair: Object.entries(notionalByPair).map(([pair, notional]) => ({ pair, notional })).sort((a, b) => b.notional - a.notional),
  };
}

// ---- Sales income ----
// Rows: { stream, period 'YYYY-MM', amount_gbp, received_gbp }. Returns per-stream
// totals, a by-month matrix (stream columns), and the invoiced-vs-received gap.
export function salesIncomeSummary(rows = []) {
  const byStream = {};
  for (const s of SALES_STREAMS) byStream[s.code] = { code: s.code, label: s.label, invoiced: 0, received: 0 };
  const monthsMap = {};
  for (const r of rows) {
    if (!byStream[r.stream]) continue;
    byStream[r.stream].invoiced = round2(byStream[r.stream].invoiced + num(r.amount_gbp));
    byStream[r.stream].received = round2(byStream[r.stream].received + num(r.received_gbp));
    const m = r.period || "—";
    monthsMap[m] = monthsMap[m] || { month: m, RETAIL: 0, WHOLESALE: 0, FRANCHISE: 0, total: 0 };
    monthsMap[m][r.stream] = round2((monthsMap[m][r.stream] || 0) + num(r.amount_gbp));
    monthsMap[m].total = round2(monthsMap[m].total + num(r.amount_gbp));
  }
  const invoiced = round2(Object.values(byStream).reduce((t, s) => t + s.invoiced, 0));
  const received = round2(Object.values(byStream).reduce((t, s) => t + s.received, 0));
  return {
    streams: Object.values(byStream),
    byMonth: Object.values(monthsMap).sort((a, b) => String(a.month).localeCompare(String(b.month))),
    invoiced, received, outstanding: round2(invoiced - received),
  };
}

// ---- Store cash reconciliation ----
export function cashReconVariance(row = {}) { return round2(num(row.banked_cash) - num(row.expected_cash)); }
export function cashReconStatus(row = {}) {
  const v = cashReconVariance(row);
  if ((row.status || "OPEN") === "RECONCILED" || v === 0) return { label: "Reconciled", tone: "green" };
  if (Math.abs(v) > 0) return { label: v < 0 ? "Short" : "Over", tone: Math.abs(v) > 0 ? "red" : "amber" };
  return { label: "Open", tone: "amber" };
}
export function cashReconSummary(rows = []) {
  const expected = round2(rows.reduce((t, r) => t + num(r.expected_cash), 0));
  const banked = round2(rows.reduce((t, r) => t + num(r.banked_cash), 0));
  const exceptions = rows.filter((r) => cashReconVariance(r) !== 0 && (r.status || "OPEN") !== "RECONCILED").length;
  return { count: rows.length, expected, banked, variance: round2(banked - expected), exceptions };
}

export { round2 as tRound2 };
