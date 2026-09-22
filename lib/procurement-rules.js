/*
 * Procurement — pure, unit-testable. Supplier payment terms decide when cash
 * leaves: cash-out month = the month the invoice falls due (order month-end +
 * terms days). Committed spend is then summarised by cash-out month per source
 * and compared to that month's cash budget — the merch team's budget control.
 */

import { parseCsv, parseCsvRows } from "./intercompany-rules.js";

export const SOURCES = {
  MINISO: "Miniso purchases",
  LOCAL: "Local purchases",
};

// Miniso HQ (Guangzhou) buys on fixed 180-day terms, calculated from the goods
// pickup (ex-works) date rather than the order month.
export const MINISO_TERMS_DAYS = 180;

// order_ym 'YYYY-MM' + terms days → cash-out 'YYYY-MM'. Uses month-end as the
// invoice date (goods received end of order month), then adds the terms.
export function cashOutYm(orderYm, termsDays) {
  const m = /^(\d{4})-(\d{2})$/.exec(orderYm || "");
  if (!m) return orderYm;
  const y = +m[1], mo = +m[2];
  // last day of the order month, then + terms days
  const end = new Date(Date.UTC(y, mo, 0));            // day 0 of next month = last day of this month
  end.setUTCDate(end.getUTCDate() + (Number(termsDays) || 0));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
}

// A specific date 'YYYY-MM-DD' + days → cash-out 'YYYY-MM'. Used for Miniso HQ,
// where the 180-day clock starts on the pickup date.
export function cashOutFromDate(dateStr, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The cash-out month for a purchase. Miniso HQ with a pickup date = pickup + 180 days
// (the fixed HQ terms); otherwise the order-month basis with the row's own terms
// (legacy / CSV rows and Local purchases).
export function cashOutFor(p = {}) {
  if (p.source === "MINISO" && p.pickup_date) {
    const ym = cashOutFromDate(p.pickup_date, MINISO_TERMS_DAYS);
    if (ym) return ym;
  }
  return cashOutYm(p.order_ym, p.terms_days);
}

// ---- Spent: how the committed cash actually went out (migration 113) ----
// Committed is what we have ordered; SPENT is what has actually been settled, and
// it settles two ways:
//   * TRADE PAY — drawn on the HSBC trade facility. The facility upload
//     (finance.bank_trade_facility) is the source of truth for it, so trade-pay
//     spend is read from there, never from the purchase rows.
//   * CASH — settled directly, so it is spend ON TOP of the facility. Read from
//     the purchases Finance tagged CASH when marking them paid.
// Keeping them apart is what lets Merch see how a month was actually funded.

// The facility upload's cost_driver is free text typed into the HSBC extract, so
// it is matched loosely — on the phrase, not the exact string. That absorbs the
// spelling drift the column actually carries ("Miniso LC's" / "Miniso LCs" /
// "Miniso LC", "Local Purchase" / "Local Purchases"), because a driver we fail to
// recognise silently reports zero spend rather than erroring, which is the worst
// way for this to be wrong.
//
// Miniso stock reaches us two ways and the facility names them differently:
// "Miniso LC" is the post-shipment buyer loan drawn against a letter of credit,
// "Miniso Facility" is the same stock settled on TradePay instead. Both are
// procurement, so both count.
//
// What must NOT match is "Miniso Investment" — intercompany funding, no more
// procurement than Opex or Capex. So the Miniso patterns name the instrument
// explicitly rather than matching "miniso" broadly; a driver we don't recognise
// is ignored, and ignoring real spend is the failure mode that hides itself.
export const FACILITY_PROC_DRIVERS = [
  [/miniso\s*lc/, "MINISO"],
  [/miniso\s*facilit/, "MINISO"],
  [/local\s*purchase/, "LOCAL"],
];
// Which procurement source a facility drawing belongs to, or null when it isn't
// procurement at all.
export function facilitySourceOf(row = {}) {
  const d = String(row.cost_driver || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[’´`]/g, "'");
  if (!d) return null;
  for (const [re, src] of FACILITY_PROC_DRIVERS) if (re.test(d)) return src;
  return null;
}

// 'YYYY-MM-DD' / Date / 'YYYY-MM' → 'YYYY-MM'. Null when there's nothing to read.
export function ymOf(value) {
  if (!value) return null;
  const s = typeof value === "string" ? value : new Date(value).toISOString();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}` : null;
}

const emptySpend = () => ({ MINISO: {}, LOCAL: {} });

// Trade-pay spend by source and PAYMENT month, from the facility upload. The
// whole table runs on a payment-date basis — committed lands in the month a new
// request's payment terms make it fall due, so spend has to land in the month the
// money actually leaves. For a facility drawing that is its due date (when the
// drawing is repaid), which for a Miniso post-shipment loan is materially later
// than the drawdown. payment_month is the fallback for an upload that has no due
// date on a row.
// The GBP value of a facility drawing. The bank's own GBP figure wins when the
// extract carries one. Not every extract does — it may give only the payment
// amount and its currency — and a drawing worth nothing is indistinguishable
// from a month with no spend, so fall back rather than report zero:
//   * a GBP drawing is its payment amount as it stands;
//   * a foreign drawing converts at the SPOT rate for its currency, which
//     `rateFor` supplies (quoted foreign-per-£1, so GBP = amount / rate).
// Returns null when the value genuinely cannot be established — a foreign
// drawing with no rate set — so the caller can say so instead of silently
// counting it as nil.
export function facilityGbp(row = {}, rateFor = null) {
  if (row.facility_payment_gbp != null && Number(row.facility_payment_gbp)) return Number(row.facility_payment_gbp);
  const amt = Number(row.payment_amount);
  if (!Number.isFinite(amt) || !amt) return null;
  const ccy = String(row.payment_currency || "GBP").toUpperCase();
  if (!ccy || ccy === "GBP") return amt;
  const rate = rateFor ? Number(rateFor(ccy)) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return null;   // no rate — don't guess
  return amt / rate;
}

// facility: [{cost_driver, due_date, payment_month, facility_payment_gbp,
//             payment_amount, payment_currency}]
// rateFor:  (currency) => spot rate, foreign-per-£1. Optional; without it a
//           foreign drawing lacking a GBP figure cannot be valued.
// Also reports `unvalued` — drawings that are procurement and dated but whose
// GBP value could not be established, so the UI can distinguish "no spend" from
// "spend we could not price".
export function tradeSpendByMonth(facility = [], rateFor = null) {
  const out = emptySpend();
  out.unvalued = { MINISO: 0, LOCAL: 0 };
  for (const f of facility) {
    const src = facilitySourceOf(f);
    if (!src) continue;
    const ym = ymOf(f.due_date) || ymOf(f.payment_month);
    if (!ym) continue;
    const gbp = facilityGbp(f, rateFor);
    if (gbp == null) { out.unvalued[src] += 1; continue; }
    out[src][ym] = (out[src][ym] || 0) + gbp;
  }
  return out;
}

// Cash spend by source and month, from the purchases Finance marked paid AND
// tagged CASH. Rows tagged TRADE_PAY are deliberately skipped — the facility
// upload already reports them, and counting both would double up. An untagged
// paid row (paid before the method was captured) is skipped too rather than
// guessed at. Falls back to the cash-out month when no paid date was recorded.
export function cashSpendByMonth(purchases = []) {
  const out = emptySpend();
  for (const p of purchases) {
    if (p.payment_method !== "CASH") continue;
    if (!out[p.source]) continue;
    const ym = ymOf(p.paid_date) || cashOutFor(p);
    if (!ym) continue;
    out[p.source][ym] = (out[p.source][ym] || 0) + (Number(p.amount_gbp) || 0);
  }
  return out;
}

// purchases: [{source, supplier, category, order_ym, amount_gbp, terms_days, status}]
// budgets:   [{source, ym, budget_gbp}]
// spend:     {trade, cash} — each {MINISO: {ym: £}, LOCAL: {ym: £}} (optional;
//            omitted means no facility upload / no tagged cash yet, and the
//            spend columns read zero).
// Returns per source: months[] (cash-out ym → committed, paid, trade/cash/total
// spent, budget, variance), suppliers[] (terms + committed), totals.
export function summarise(purchases, budgets, spend = {}) {
  const trade = spend.trade || emptySpend();
  const cash = spend.cash || emptySpend();
  const out = {};
  for (const key of Object.keys(SOURCES)) {
    const mine = purchases.filter((p) => p.source === key);
    const byMonth = {};
    const bySupplier = {};
    for (const p of mine) {
      const amt = Number(p.amount_gbp) || 0;
      const ym = cashOutFor(p);
      (byMonth[ym] ||= { ym, committed: 0, paid: 0 });
      byMonth[ym].committed += amt;
      if (p.status === "PAID") byMonth[ym].paid += amt;
      const s = (bySupplier[p.supplier] ||= { supplier: p.supplier, terms_days: Number(p.terms_days) || 0, committed: 0, orders: 0 });
      s.committed += amt; s.orders += 1; s.terms_days = Number(p.terms_days) || 0;
    }
    const bud = {};
    for (const b of budgets.filter((b) => b.source === key)) bud[b.ym] = Number(b.budget_gbp) || 0;
    const tradeM = trade[key] || {};
    const cashM = cash[key] || {};
    // A month is worth a row if anything lands in it — an order, a budget, or a
    // settlement (spend can fall in a month that has no order of its own).
    const yms = [...new Set([...Object.keys(byMonth), ...Object.keys(bud), ...Object.keys(tradeM), ...Object.keys(cashM)])].sort();
    const months = yms.map((ym) => {
      const committed = byMonth[ym]?.committed || 0;
      const budget = bud[ym] ?? null;
      const tradeSpent = tradeM[ym] || 0;
      const cashSpent = cashM[ym] || 0;
      const spent = tradeSpent + cashSpent;
      return {
        ym, committed, paid: byMonth[ym]?.paid || 0, budget,
        tradeSpent, cashSpent, spent,
        variance: budget == null ? null : budget - committed,       // +ve = headroom
        spentVariance: budget == null ? null : budget - spent,      // +ve = headroom on actuals
        overBudget: budget != null && committed > budget,
        overSpent: budget != null && spent > budget,
      };
    });
    const suppliers = Object.values(bySupplier).sort((a, b) => b.committed - a.committed);
    const sum = (o) => Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0);
    out[key] = {
      months, suppliers,
      totalCommitted: mine.reduce((s, p) => s + (Number(p.amount_gbp) || 0), 0),
      totalBudget: Object.values(bud).reduce((s, v) => s + v, 0),
      unvaluedDrawings: trade.unvalued?.[key] || 0,
      totalTradeSpent: sum(tradeM),
      totalCashSpent: sum(cashM),
      totalSpent: sum(tradeM) + sum(cashM),
    };
  }
  return out;
}

// ---- Budget check at the point of raising ----
// What a new request would do to the month it falls due in, so Merch can see
// where they stand against budget BEFORE they submit rather than finding out at
// Finance review. `months` is a source's rows from summarise(); `ym` the cash-out
// month the request lands in (cashOutFor on the draft); `addGbp` its GBP value.
//
// Returns null when there isn't enough of the form filled in to say anything.
// A month with no budget set still reports (noBudget), because "nothing is
// budgeted here" is itself worth showing at the point of raise.
export function budgetImpact(months = [], ym = null, addGbp = 0) {
  if (!ym) return null;
  const add = Number(addGbp) || 0;
  const row = months.find((m) => m.ym === ym) || null;
  const budget = row && row.budget != null ? Number(row.budget) : null;
  const committed = row ? Number(row.committed) || 0 : 0;
  const spent = row ? Number(row.spent) || 0 : 0;
  const newCommitted = committed + add;
  return {
    ym, budget, committed, spent, add, newCommitted,
    noBudget: budget == null,
    // +ve = headroom left after this request; -ve = it takes the month over.
    headroom: budget == null ? null : budget - newCommitted,
    over: budget != null && newCommitted > budget,
    // True only when this request is what tips it over — useful for wording the
    // warning ("this takes you over" vs "already over before this").
    alreadyOver: budget != null && committed > budget,
  };
}

// ---- Finance control view: requests still to decide, vs the budgets set ----
// The budget tables show what is already committed. This shows the PRESSURE
// still coming: the requests awaiting a decision, in the month each falls due,
// and what approving them all would do to that month's budget.
//
// The two screens run different lifecycles over the same table — the Requests
// page tracks `approval_status` (raise → head → Finance), the close desk tracks
// `finance_status` (approve → challenge → close) — so the caller passes the
// predicate for what "awaiting" means to it, rather than this guessing.
//
// Values use amount_gbp throughout, the same basis the budget tables commit on,
// so the two can be read side by side. Months are returned only where something
// is actually awaiting, newest last — a month with nothing pending is not a
// control problem and would only be noise.
export function requestsVsBudget(rows = [], months = [], isAwaiting = () => false, { all = false } = {}) {
  const byMonth = {};
  for (const r of rows) {
    const ym = cashOutFor(r);
    if (!ym) continue;
    const amt = Number(r.amount_gbp) || 0;
    const b = (byMonth[ym] ||= { ym, awaiting: 0, awaitingCount: 0, settled: 0 });
    if (isAwaiting(r)) { b.awaiting += amt; b.awaitingCount += 1; }
    else b.settled += amt;
  }

  // Which months are worth a row. A month with a queue is the obvious one, but a
  // month ALREADY over on what is committed or spent has to be explained too,
  // whether or not anything is pending against it — so those are included even
  // with an empty queue. `all` drops the filter entirely, for when Finance want
  // the whole horizon rather than just the exceptions.
  const flagged = months.filter((m) => m.overBudget || m.overSpent).map((m) => m.ym);
  const keys = all
    ? [...new Set([...months.map((m) => m.ym), ...Object.keys(byMonth)])]
    : [...new Set([...Object.keys(byMonth).filter((ym) => byMonth[ym].awaitingCount > 0), ...flagged])];

  return keys
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((ym) => {
      const b = byMonth[ym] || { ym, awaiting: 0, awaitingCount: 0, settled: 0 };
      const row = months.find((m) => m.ym === ym) || null;
      const budget = row && row.budget != null ? Number(row.budget) : null;
      const wouldCommit = b.settled + b.awaiting;
      return {
        ...b, budget, wouldCommit,
        // The budget table's own view of the month, so Finance can see WHY it is
        // listed: committed is every non-cancelled order, spent what has settled.
        committed: row ? Number(row.committed) || 0 : 0,
        spent: row ? Number(row.spent) || 0 : 0,
        overBudget: !!(row && row.overBudget),
        overSpent: !!(row && row.overSpent),
        noBudget: budget == null,
        headroom: budget == null ? null : budget - wouldCommit,
        over: budget != null && wouldCommit > budget,
        // Already over on what Finance has settled alone, before the pending
        // requests are even considered.
        alreadyOver: budget != null && b.settled > budget,
      };
    });
}

// ---- Budget forecast import ----
// Finance keep the procurement budget as a forecast in Excel: one row per source,
// one column per month. Keying it in a cell at a time is slow and easy to get
// wrong, so the grid layout is read directly.
//
//   Source  | Sep-26 | Oct-26 | Nov-26 | …
//   Miniso  | 180000 | 210000 | 195000 | …
//   Local   |  60000 |  55000 |  62000 | …

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// A column header → 'YYYY-MM', or null when the column isn't a month (the label
// column, a "Total", a blank). Accepts the forms a spreadsheet actually exports:
// Sep-26, Sep 2026, September 2026, 2026-09, 09/2026, 01/09/2026.
export function parseMonthHeader(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let m;
  // 2026-09 / 2026-09-01 / 2026/09
  if ((m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(s))) return ymFromParts(m[1], m[2]);
  // 01/09/2026 or 09/2026 (UK order: day first when there are three parts)
  if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) return ymFromParts(m[3], m[2]);
  if ((m = /^(\d{1,2})[-/](\d{4})$/.exec(s))) return ymFromParts(m[2], m[1]);
  // sep-26 / sep 2026 / september 2026 / sept-26
  if ((m = /^([a-z]{3,9})[- ]?(\d{2}|\d{4})$/.exec(s))) {
    const idx = MONTH_NAMES.indexOf(m[1].slice(0, 3));
    if (idx < 0) return null;
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return ymFromParts(y, idx + 1);
  }
  return null;
}
function ymFromParts(year, month) {
  const y = Number(year), mo = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

// A row label → MINISO / LOCAL / null. Matched on the phrase, since the label is
// whatever Finance typed ("Miniso", "Miniso HQ", "Local Purchase", "LP").
export function parseBudgetSource(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (/miniso|\bhq\b/.test(s)) return "MINISO";
  if (/local|^lp$|\blp\b/.test(s)) return "LOCAL";
  return null;
}

const budgetNum = (v) => {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return null;
  // Strip currency, thousands separators and spaces; read (1,234) as negative.
  const neg = /^\(.*\)$/.test(raw);
  const n = Number(raw.replace(/[()]/g, "").replace(/[£$,\s]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
};

// Find the header row — the one carrying the months. A spreadsheet export very
// often has a title line, a blank line or a note above it, so the first row
// cannot be assumed to be the header. Scores each row by how many of its cells
// read as a month and takes the best, earliest on a tie. Data rows hold numbers,
// not months, so they score zero and never win.
export function findMonthHeaderRow(rows = []) {
  let best = -1, bestScore = 0;
  const limit = Math.min(rows.length, 50);
  for (let i = 0; i < limit; i++) {
    const score = rows[i].filter((c) => parseMonthHeader(c)).length;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore ? best : -1;
}

// Parse the grid into { records: [{source, ym, budget_gbp}], errors: [...] }.
// Works on column POSITION rather than header text, so two columns sharing a
// header (a month repeated) stay distinct and can be reported, instead of one
// silently overwriting the other.
//
// Blank cells are skipped rather than written as zero — a gap in the forecast
// means "not budgeted", which is not the same as "budgeted nil", and writing
// zeros would wipe months Finance had already set.
export function parseBudgetGridCsv(text) {
  const rows = parseCsvRows(text);
  const errors = [];
  if (!rows.length) return { records: [], errors: [{ row: 1, reason: "The file is empty" }] };

  const headerIdx = findMonthHeaderRow(rows);
  if (headerIdx < 0) {
    return { records: [], errors: [{ row: 1, reason: "No month columns found — one row should carry the months (e.g. Sep-26, 2026-09)" }] };
  }
  const header = rows[headerIdx];
  const monthCols = header.map((h, i) => ({ i, h: String(h || "").trim(), ym: parseMonthHeader(h) })).filter((c) => c.ym);

  // A month appearing twice is a genuine conflict — say so rather than letting
  // one column quietly win.
  const seen = new Set();
  for (const c of monthCols) {
    if (seen.has(c.ym)) errors.push({ row: headerIdx + 1, reason: `Month ${c.h} appears more than once` });
    seen.add(c.ym);
  }

  const out = [];
  rows.slice(headerIdx + 1).forEach((r, idx) => {
    const rowNo = headerIdx + idx + 2;
    const cells = r.map((c) => String(c == null ? "" : c).trim());
    // The source is whichever cell names one — usually the first, but a sheet
    // often has a blank or label column before it.
    let source = null;
    for (const c of cells) { source = parseBudgetSource(c); if (source) break; }
    if (!source) {
      // A blank row, or the summary row every real export carries, is expected —
      // skip both silently. Flag anything else, so a source row we failed to
      // recognise never vanishes without saying so.
      const labels = cells.filter(Boolean);
      const isSummary = labels.some((v) => /^(grand\s+)?(total|subtotal|sum)\b/i.test(v));
      if (labels.length && !isSummary) {
        errors.push({ row: rowNo, reason: "Could not tell whether this row is Miniso or Local" });
      }
      return;
    }
    for (const c of monthCols) {
      const n = budgetNum(cells[c.i]);
      if (n === null) continue;                        // blank = not budgeted
      if (Number.isNaN(n)) { errors.push({ row: rowNo, reason: `Unreadable amount in ${c.h}` }); continue; }
      if (n < 0) { errors.push({ row: rowNo, reason: `Negative budget in ${c.h}` }); continue; }
      out.push({ source, ym: c.ym, budget_gbp: Math.round(n * 100) / 100 });
    }
  });

  // The same source+month twice over (two Miniso rows) is a real conflict.
  const byKey = new Map();
  for (const r of out) {
    const k = `${r.source}\u00b7${r.ym}`;
    if (byKey.has(k) && byKey.get(k) !== r.budget_gbp) errors.push({ row: 0, reason: `Two different budgets given for ${r.source} ${r.ym}` });
    byKey.set(k, r.budget_gbp);
  }
  return { records: out, errors };
}

export const BUDGET_CSV_TEMPLATE = "Source,Sep-26,Oct-26,Nov-26,Dec-26\nMiniso,180000,210000,195000,240000\nLocal,60000,55000,62000,70000";

// --- CSV: Source, Supplier, Category, Order Month, Amount, Terms (days), Status, Reference
export const PROCUREMENT_CSV_TEMPLATE = "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseProcurementCsv(text) {
  const { headers, records } = parseCsv(text);
  const h = headers.map((x) => x.toLowerCase().trim());
  const col = (...frags) => { const i = h.findIndex((x) => frags.some((f) => x.includes(f))); return i < 0 ? null : headers[i]; };
  const cSrc = col("source"), cSup = col("supplier"), cCat = col("category"),
    cYm = col("order month", "month", "order"), cAmt = col("amount", "value"),
    cTerms = col("terms"), cStatus = col("status"), cRef = col("reference", "ref", "po");
  const out = [], errors = [];
  records.forEach((r, idx) => {
    let source = String(r[cSrc] || "").trim().toUpperCase();
    if (source.startsWith("MINISO")) source = "MINISO";
    else if (source.startsWith("LOCAL")) source = "LOCAL";
    const supplier = cSup ? String(r[cSup] || "").trim() : "";
    const amount = num(r[cAmt]);
    const ymRaw = cYm ? String(r[cYm] || "").trim() : "";
    const ym = /^(\d{4})-(\d{2})/.test(ymRaw) ? ymRaw.slice(0, 7)
      : (/^(\d{1,2})\/(\d{4})$/.test(ymRaw) ? `${ymRaw.split("/")[1]}-${ymRaw.split("/")[0].padStart(2, "0")}` : null);
    if (!["MINISO", "LOCAL"].includes(source)) { errors.push({ row: idx + 2, reason: "Source must be Miniso or Local" }); return; }
    if (!supplier) { errors.push({ row: idx + 2, reason: "missing supplier" }); return; }
    if (amount == null) { errors.push({ row: idx + 2, reason: "missing amount" }); return; }
    if (!ym) { errors.push({ row: idx + 2, reason: `unreadable order month "${ymRaw}" (use YYYY-MM)` }); return; }
    const status = /paid/i.test(String(r[cStatus] || "")) ? "PAID" : "COMMITTED";
    out.push({
      source, supplier, category: cCat ? String(r[cCat] || "").trim() || null : null,
      order_ym: ym, amount_gbp: amount, terms_days: Math.max(0, Math.round(num(cTerms ? r[cTerms] : 0) || 0)),
      status, reference: cRef ? String(r[cRef] || "").trim() || null : null,
    });
  });
  return { records: out, errors };
}

/*
 * Approval lifecycle (migration 082) — raise → HOD_APPROVED → APPROVED, plus
 * CANCELLED. Mirrors the P.O workflow: a raised order needs Head of Department
 * sign-off then Finance; anyone managing procurement can cancel; only Finance
 * can delete, and only once the Head of Department has approved. Pure + tested.
 */
export const PROC_APPROVAL_STATUSES = ["PENDING", "HOD_APPROVED", "APPROVED", "CANCELLED"];
export const PROC_STATUS_META = {
  PENDING: { label: "Pending approval", tone: "amber" },
  HOD_APPROVED: { label: "Head approved", tone: "accent" },
  APPROVED: { label: "Approved", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

// A cancelled order is treated as APPROVED for the migration backfill only; the
// live default for a newly raised order is PENDING.
const hodApproved = (s) => s === "HOD_APPROVED" || s === "APPROVED";

// Head of Department sign-off — only a still-pending order can be HOD-approved.
export function canHodApprove(line = {}) { return line.approval_status === "PENDING"; }
// Finance sign-off — a pending or head-approved order (Finance can also approve directly).
export function canFinanceApprove(line = {}) { return line.approval_status === "PENDING" || line.approval_status === "HOD_APPROVED"; }
// Cancel is the soft action — available on anything not already cancelled.
export function canCancelProcurement(line = {}) { return line.approval_status !== "CANCELLED"; }

// Delete gate: Finance (or admin) only, and only once the Head of Department has
// approved. Everything else must be cancelled, not deleted.
export function canDeleteProcurement(line = {}, { isFinance = false, isAdmin = false } = {}) {
  if (isAdmin) return { ok: true };
  if (!isFinance) return { ok: false, reason: "Only Finance can delete a procurement order" };
  if (!hodApproved(line.approval_status)) return { ok: false, reason: "A procurement order can only be deleted once the Head of Department has approved it" };
  return { ok: true };
}
