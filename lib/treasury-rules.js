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

const monthOf = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 7);
  return String(d).slice(0, 7); // 'YYYY-MM-DD' → 'YYYY-MM'
};

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

// ---- DC → LC → post-shipment loan lifecycle (Miniso imports) ----
// The trade-facility journey for a Miniso import: a documentary collection (DC)
// is logged, an LC is confirmed (import loan, goods in transit), goods arrive in
// Miniso UK's possession (converts to a trade loan), the facility is drawn
// (actual payment), and finally the LC settles. Stage is inferred from which
// milestones a procurement LC row has reached.
export const LC_STAGES = [
  { code: "PENDING", label: "Pending", tone: "muted" },
  { code: "DC_LOGGED", label: "DC logged", tone: "muted" },
  { code: "LC_CONFIRMED", label: "LC confirmed · import", tone: "amber" },
  { code: "TRADE_LOAN", label: "Trade loan · arrived", tone: "amber" },
  { code: "DRAWN", label: "Loan drawn", tone: "accent" },
  { code: "SETTLED", label: "Settled", tone: "green" },
];
const LC_STAGE_LABEL = Object.fromEntries(LC_STAGES.map((s) => [s.code, s.label]));
export function lcStageLabel(code) { return LC_STAGE_LABEL[code] || code; }

export function lcStage(row = {}) {
  if (row.lc_settled) return "SETTLED";
  if (row.actual_payment_date) return "DRAWN";
  if (String(row.loan_type || "").toUpperCase() === "TRADE" || row.goods_arrived_date) return "TRADE_LOAN";
  if (row.lc_confirmed_date) return "LC_CONFIRMED";
  if (row.dc_reference || row.lc_reference) return "DC_LOGGED";
  return "PENDING";
}

// Roll a set of procurement-LC rows into the DC→LC→loan pipeline: count by stage,
// and the open (unsettled) count + amount by currency (LC amounts are in the
// order's own currency, so keep them split by currency rather than summing).
export function facilityLifecycleSummary(rows = []) {
  const byStage = Object.fromEntries(LC_STAGES.map((s) => [s.code, 0]));
  const openByCcy = {};
  let openCount = 0, settledCount = 0;
  for (const r of rows) {
    const st = lcStage(r);
    byStage[st] = (byStage[st] || 0) + 1;
    if (st === "SETTLED") { settledCount += 1; continue; }
    openCount += 1;
    const c = String(r.currency || "GBP").toUpperCase();
    openByCcy[c] = round2((openByCcy[c] || 0) + num(r.lc_amount));
  }
  return { total: rows.length, byStage, openCount, settledCount, openByCcy };
}

// ---- DC / LC ↔ bank trade facility reconciliation ----
// The Miniso LC reference (LAIUK…) logged in Procurement is the same reference
// HSBC draws the post-shipment buyer loan under on the bank trade facility. This
// reconciles the two: per DC, the value vs what's logged (LCs) vs what the bank
// has actually drawn on the facility, and which LCs haven't appeared yet.
export const normRef = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toUpperCase();
// LC reference placeholders that aren't a real bank drawing reference yet.
const PLACEHOLDER_REFS = new Set(["", "TBC", "TBA", "PENDING", "N/A", "-"]);
export const isRealLcRef = (r) => !PLACEHOLDER_REFS.has(normRef(r));

// Index the facility drawings by both their bank reference and the customer
// reference, so an LC matches on either. First writer wins per key.
export function facilityRefIndex(facilityRows = []) {
  const idx = new Map();
  for (const f of facilityRows) {
    for (const key of [f.reference, f.customer_reference]) {
      const k = normRef(key);
      if (k && !idx.has(k)) idx.set(k, f);
    }
  }
  return idx;
}

// Is this LC visible on the bank trade facility yet? (matched by reference)
export function lcOnFacility(lc, facilityIndex) {
  const r = normRef(lc.lc_reference);
  if (!isRealLcRef(r)) return null;         // no real reference yet → can't match
  return facilityIndex.get(r) || null;
}

// Reconcile DCs + their LCs against the facility drawings.
//   dcs: [{dc_id, purchase_id, dc_reference, dc_value, currency, purchase_ref}]
//   lcs: [{purchase_id, dc_reference, lc_reference, lc_amount, lc_settled, currency}]
//   facilityRows: bank_trade_facility rows (reference, customer_reference, loan_amount, …)
// Returns one group per DC (value, logged, drawn-on-facility, remaining, gaps)
// plus totals, all in the DC currency.
export function reconcileDcFacility(dcs = [], lcs = [], facilityRows = []) {
  const idx = facilityRefIndex(facilityRows);
  const keyOf = (purchaseId, dcRef) => `${purchaseId}·${normRef(dcRef)}`;
  const groups = new Map();
  for (const d of dcs) {
    groups.set(keyOf(d.purchase_id, d.dc_reference), {
      dc_id: d.dc_id ?? null, dc_reference: d.dc_reference || "", purchase_ref: d.purchase_ref || null,
      currency: d.currency || "USD", dc_value: d.dc_value == null ? null : Number(d.dc_value),
      lcLogged: 0, facilityDrawn: 0, lcCount: 0, onFacilityCount: 0, notOnFacility: [], lcs: [],
    });
  }
  for (const l of lcs) {
    const g = groups.get(keyOf(l.purchase_id, l.dc_reference));
    if (!g) continue;                        // LC whose DC has no record → ignored here
    const match = lcOnFacility(l, idx);
    const amount = num(l.lc_amount);
    g.lcCount += 1;
    g.lcLogged = round2(g.lcLogged + amount);
    const entry = { lc_reference: l.lc_reference, lc_amount: amount, lc_settled: !!l.lc_settled,
      onFacility: !!match, facility_reference: match ? match.reference : null,
      facility_amount: match ? num(match.loan_amount) : null,
      facility_outstanding: match ? num(match.outstanding_amount) : null,
      facility_due_date: match ? match.due_date : null, facility_status: match ? match.status : null };
    g.lcs.push(entry);
    if (match) { g.onFacilityCount += 1; g.facilityDrawn = round2(g.facilityDrawn + num(match.loan_amount)); }
    else if (!l.lc_settled) g.notOnFacility.push(l.lc_reference || "(no reference)");
  }
  const finish = (g) => {
    g.remaining = g.dc_value == null ? null : round2(g.dc_value - g.lcLogged);          // vs logged LCs
    g.facilityRemaining = g.dc_value == null ? null : round2(g.dc_value - g.facilityDrawn); // vs bank-drawn
    g.gap = round2(g.lcLogged - g.facilityDrawn);   // logged but not yet drawn on facility
    g.utilisation = g.dc_value ? g.lcLogged / g.dc_value : null;
    g.over = g.remaining != null && g.remaining < -0.005;
    g.notOnFacilityCount = g.notOnFacility.length;
    return g;
  };
  const out = [...groups.values()].map(finish);
  const withVal = out.filter((g) => g.dc_value != null);
  const totals = {
    dcCount: out.length,
    currency: out[0]?.currency || "USD",
    totalValue: round2(withVal.reduce((t, g) => t + (g.dc_value || 0), 0)),
    totalLogged: round2(out.reduce((t, g) => t + g.lcLogged, 0)),
    totalDrawn: round2(out.reduce((t, g) => t + g.facilityDrawn, 0)),
    totalRemaining: round2(withVal.reduce((t, g) => t + (g.remaining || 0), 0)),
    notOnFacilityCount: out.reduce((t, g) => t + g.notOnFacilityCount, 0),
  };
  totals.gap = round2(totals.totalLogged - totals.totalDrawn);
  return { rows: out, totals };
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
