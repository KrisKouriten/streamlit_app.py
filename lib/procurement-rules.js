/*
 * Procurement — pure, unit-testable. Supplier payment terms decide when cash
 * leaves: cash-out month = the month the invoice falls due (order month-end +
 * terms days). Committed spend is then summarised by cash-out month per source
 * and compared to that month's cash budget — the merch team's budget control.
 */

import { parseCsv } from "./intercompany-rules.js";

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
// Order matters: "miniso lc" is tested before the Miniso-wide fallbacks so that
// "Miniso Investment" — which is NOT procurement, any more than Opex or Capex —
// never matches. Anything unrecognised is ignored.
export const FACILITY_PROC_DRIVERS = [
  [/miniso\s*lc/, "MINISO"],
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
// facility: [{cost_driver, due_date, payment_month, facility_payment_gbp}]
export function tradeSpendByMonth(facility = []) {
  const out = emptySpend();
  for (const f of facility) {
    const src = facilitySourceOf(f);
    if (!src) continue;
    const ym = ymOf(f.due_date) || ymOf(f.payment_month);
    if (!ym) continue;
    out[src][ym] = (out[src][ym] || 0) + (Number(f.facility_payment_gbp) || 0);
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
export function requestsVsBudget(rows = [], months = [], isAwaiting = () => false) {
  const byMonth = {};
  for (const r of rows) {
    const ym = cashOutFor(r);
    if (!ym) continue;
    const amt = Number(r.amount_gbp) || 0;
    const b = (byMonth[ym] ||= { ym, awaiting: 0, awaitingCount: 0, settled: 0 });
    if (isAwaiting(r)) { b.awaiting += amt; b.awaitingCount += 1; }
    else b.settled += amt;
  }
  return Object.values(byMonth)
    .filter((b) => b.awaitingCount > 0)
    .sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0))
    .map((b) => {
      const row = months.find((m) => m.ym === b.ym) || null;
      const budget = row && row.budget != null ? Number(row.budget) : null;
      const wouldCommit = b.settled + b.awaiting;
      return {
        ...b, budget, wouldCommit,
        noBudget: budget == null,
        headroom: budget == null ? null : budget - wouldCommit,
        over: budget != null && wouldCommit > budget,
        // Already over on what Finance has settled alone, before the pending
        // requests are even considered.
        alreadyOver: budget != null && b.settled > budget,
      };
    });
}

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
