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

// Index the facility drawings by their bank reference — the reference Finance
// keys on the LC and HSBC draws under. First writer wins per key.
export function facilityRefIndex(facilityRows = []) {
  const idx = new Map();
  for (const f of facilityRows) {
    const k = normRef(f.reference);
    if (k && !idx.has(k)) idx.set(k, f);
  }
  return idx;
}

// Is this LC visible on the bank trade facility yet? Matched on the LC reference —
// the reference Finance keys and HSBC draws under.
export function lcOnFacility(lc, facilityIndex) {
  const r = normRef(lc.lc_reference);
  if (isRealLcRef(r)) { const m = facilityIndex.get(r); if (m) return m; }
  return null;
}

// Facility drawings whose reference matches no LC in Procurement — a bank drawing
// with nothing logged against it yet, for the team to reconcile by adding the
// missing DC/LC. Pure. Considers ALL LCs (not just DC-grouped ones). Carries the
// beneficiary + customer reference from the HSBC extract for context.
export function unmatchedFacility(lcs = [], facilityRows = []) {
  const lcKeys = new Set();
  for (const l of lcs) { const n = normRef(l.lc_reference); if (isRealLcRef(n)) lcKeys.add(n); }
  return facilityRows
    .filter((f) => { const k = normRef(f.reference); return !(k && lcKeys.has(k)); })
    .map((f) => ({ reference: f.reference, beneficiary: f.beneficiary || null, customer_reference: f.customer_reference || null,
      loan_amount: f.loan_amount == null ? null : Number(f.loan_amount), loan_currency: f.loan_currency || null,
      due_date: f.due_date || null, status: f.status || null }));
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

// ---- HSBC bank trade facility CSV upload (replace-mode) ----
// The canonical upload columns. `reference` (the bank drawing reference, e.g.
// LAIUK…) is the only required field — it's what the LC reconciliation matches
// on. The rest are optional but drive the settlement calendar + reconciliation.
export const FACILITY_UPLOAD_COLUMNS = [
  "reference", "beneficiary", "customer_reference", "payment_currency",
  "loan_amount", "loan_currency", "outstanding_amount", "status", "product_type",
  "cost_driver", "loan_start_date", "due_date", "loan_period_days",
  "payment_amount", "payment_month", "facility_payment_gbp",
];
const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
// Map a variety of likely HSBC/finance header spellings to our canonical columns.
const HEADER_ALIASES = {
  reference: "reference", bankreference: "reference", loanreference: "reference", ourreference: "reference", dealreference: "reference", drawingreference: "reference",
  beneficiary: "beneficiary", supplier: "beneficiary", payee: "beneficiary", counterparty: "beneficiary",
  customerreference: "customer_reference", customerref: "customer_reference", yourreference: "customer_reference", lcreference: "customer_reference", invoicereference: "customer_reference",
  paymentcurrency: "payment_currency", currency: "payment_currency", ccy: "payment_currency",
  loanamount: "loan_amount", amount: "loan_amount", drawingamount: "loan_amount", principal: "loan_amount",
  loancurrency: "loan_currency",
  outstandingamount: "outstanding_amount", outstanding: "outstanding_amount", balance: "outstanding_amount",
  status: "status",
  producttype: "product_type", product: "product_type",
  costdriver: "cost_driver", driver: "cost_driver", category: "cost_driver",
  loanstartdate: "loan_start_date", startdate: "loan_start_date", start: "loan_start_date", drawdowndate: "loan_start_date", disbursementdate: "loan_start_date", disbursedate: "loan_start_date",
  duedate: "due_date", due: "due_date", maturitydate: "due_date", maturity: "due_date",
  loanperioddays: "loan_period_days", days: "loan_period_days", tenor: "loan_period_days", period: "loan_period_days", loanperiod: "loan_period_days",
  paymentamount: "payment_amount",
  paymentmonth: "payment_month", settlementmonth: "payment_month", month: "payment_month",
  facilitypaymentgbp: "facility_payment_gbp", facilitygbp: "facility_payment_gbp", gbp: "facility_payment_gbp", gbpequivalent: "facility_payment_gbp", gbpamount: "facility_payment_gbp",
};

function splitCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}
const csvNum = (v) => { const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""); if (s === "" || s === "-" || s === ".") return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const csvInt = (v) => { const n = csvNum(v); return n == null ? null : Math.round(n); };
// Accept YYYY-MM-DD or DD/MM/YYYY (UK); return 'YYYY-MM-DD' or null. `bad` set true on an unparseable non-blank value.
function csvDate(v, bad) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  if (bad) bad.v = true; return null;
}
function csvMonth(v, bad) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-01`;
  const d = csvDate(s, bad);
  return d ? `${d.slice(0, 7)}-01` : null;
}

// Parse an HSBC facility extract CSV into rows ready for a replace-load. Pure.
// Returns { rows, errors } — errors is a list of human-readable problems; when
// non-empty the caller should reject the upload rather than partially load.
export function parseFacilityCsv(text) {
  const errors = [];
  const lines = String(text || "").split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) { errors.push("The file needs a header row and at least one data row."); return { rows: [], errors }; }
  const rawHeaders = splitCsvLine(lines[0]).map(normHeader);
  const cols = rawHeaders.map((h) => HEADER_ALIASES[h] || null);
  if (!cols.includes("reference")) { errors.push("A 'reference' column is required (the bank drawing reference, e.g. LAIUK…)."); return { rows: [], errors }; }
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const rec = {};
    cols.forEach((c, ci) => { if (c) rec[c] = (cells[ci] ?? "").trim(); });
    const reference = (rec.reference || "").trim();
    if (!reference) { errors.push(`Row ${i}: missing reference — skipped.`); continue; }
    const key = reference.toUpperCase();
    if (seen.has(key)) { errors.push(`Row ${i}: duplicate reference “${reference}”.`); continue; }
    seen.add(key);
    const bad = {};
    const row = {
      reference,
      beneficiary: rec.beneficiary || null,
      customer_reference: rec.customer_reference || null,
      payment_currency: (rec.payment_currency || "").toUpperCase().slice(0, 4) || null,
      loan_amount: csvNum(rec.loan_amount),
      loan_currency: (rec.loan_currency || rec.payment_currency || "").toUpperCase().slice(0, 4) || null,
      outstanding_amount: rec.outstanding_amount != null && rec.outstanding_amount !== "" ? csvNum(rec.outstanding_amount) : csvNum(rec.loan_amount),
      status: rec.status || null,
      product_type: rec.product_type || null,
      loan_start_date: csvDate(rec.loan_start_date, bad),
      due_date: csvDate(rec.due_date, bad),
      loan_period_days: csvInt(rec.loan_period_days),
      payment_amount: rec.payment_amount != null && rec.payment_amount !== "" ? csvNum(rec.payment_amount) : csvNum(rec.loan_amount),
      payment_month: csvMonth(rec.payment_month, bad),
      facility_payment_gbp: csvNum(rec.facility_payment_gbp),
      cost_driver: rec.cost_driver || null,
    };
    if (bad.v) errors.push(`Row ${i} (“${reference}”): a date wasn't in DD/MM/YYYY or YYYY-MM-DD format.`);
    rows.push(row);
  }
  if (!rows.length && !errors.length) errors.push("No data rows found.");
  return { rows, errors };
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
