/*
 * Supplier trade terms on Procurement Requests — pure, unit-tested in
 * tests/supplier-terms.test.mjs.
 *
 * The person raising an order wants to know how much credit is left with a
 * supplier, and when it frees up. So, per supplier:
 *
 *   open        what we still owe on live orders: the same "still committed"
 *               balance the rest of the page uses (committedValue). An order
 *               paid in cash or on trade pay owes nothing and no longer uses
 *               the terms.
 *   due         each open order falls due on its supplier due date: the order
 *               month-end (the invoice date the cash-out month already assumes)
 *               plus the order's terms, or for Miniso the pickup date plus its
 *               terms. The next due date says when the balance next drops.
 *   aged        the open balance aged against the terms, as an aged-creditors
 *               report does: current (within terms, not yet due), then days
 *               past due 1–30, 31–60 and over 60. Also the oldest order's days
 *               outstanding since its invoice date.
 *   available   the supplier's credit limit (Supplier master) less open.
 *
 * Cancelled and draft orders are not commitments. Orders still awaiting
 * approval are counted — they will use the terms once approved — and shown
 * separately so the figure isn't mistaken for signed-off spend.
 */

import { committedValue } from "./procurement-rules.js";
import { normName, headroom } from "./suppliers-rules.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400000;

const isoDay = (d) => d.toISOString().slice(0, 10);
const utcDay = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v instanceof Date ? isoDay(v) : String(v || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

// The day an order is due to the supplier, 'YYYY-MM-DD', or null when it has no
// order month to work from.
export function supplierDueDate(o = {}) {
  const terms = Number(o.terms_days) || 0;
  if (o.source === "MINISO" && o.pickup_date) {
    const p = utcDay(o.pickup_date);
    if (p) return isoDay(new Date(p.getTime() + terms * DAY));
  }
  const m = /^(\d{4})-(\d{2})$/.exec(o.order_ym || "");
  if (!m) return null;
  const end = new Date(Date.UTC(+m[1], +m[2], 0));   // last day of the order month
  return isoDay(new Date(end.getTime() + terms * DAY));
}

const live = (o) => o.approval_status !== "CANCELLED" && o.approval_status !== "REJECTED" && o.request_status !== "DRAFT";
// Settled in cash or on trade pay: the supplier has been paid.
const paid = (o) => o.payment_status === "PAID" || o.status === "PAID";
const awaiting = (o) => o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED";

/*
 * orders     the tab's orders
 * suppliers  the Supplier master: [{ name, credit_limit, payment_days }]
 * today      a Date or 'YYYY-MM-DD'
 * → rows sorted by open (largest first), each:
 *   { supplier, terms_days, orders, openOrders, open, awaiting, dueNow, due30,
 *     later, undated, current, od30, od60, od60plus, overdue, oldestDays,
 *     nextDue: { date, amount } | null, limit, available, utilisation, over, near }
 */
export function supplierTermsPosition(orders = [], suppliers = [], today = new Date()) {
  const t = utcDay(today) || utcDay(new Date());
  const in30 = new Date(t.getTime() + 30 * DAY);
  const master = new Map((suppliers || []).map((s) => [normName(s.name), s]));
  const by = new Map();
  for (const o of orders) {
    if (!o.supplier || !live(o)) continue;
    const key = normName(o.supplier);
    const row = by.get(key) || by.set(key, {
      supplier: o.supplier, terms: [], orders: 0, openOrders: 0,
      open: 0, awaiting: 0, dueNow: 0, due30: 0, later: 0, undated: 0, byDate: new Map(),
      current: 0, od30: 0, od60: 0, od60plus: 0, oldestDays: null,
    }).get(key);
    row.orders += 1;
    row.terms.push(Number(o.terms_days) || 0);
    const owed = paid(o) ? 0 : committedValue(o);
    if (!(owed > 0)) continue;
    row.openOrders += 1;
    row.open += owed;
    if (awaiting(o)) row.awaiting += owed;
    const due = supplierDueDate(o);
    const d = utcDay(due);
    if (!d) { row.undated += owed; continue; }
    // Aged against the terms: days past the due date.
    const past = Math.round((t - d) / DAY);
    if (past <= 0) row.current += owed;
    else if (past <= 30) row.od30 += owed;
    else if (past <= 60) row.od60 += owed;
    else row.od60plus += owed;
    // Days outstanding since the invoice date (due date less the terms).
    const outstanding = past + (Number(o.terms_days) || 0);
    if (row.oldestDays == null || outstanding > row.oldestDays) row.oldestDays = Math.max(0, outstanding);
    if (d <= t) row.dueNow += owed;
    else {
      if (d <= in30) row.due30 += owed; else row.later += owed;
      row.byDate.set(due, (row.byDate.get(due) || 0) + owed);
    }
  }
  const out = [];
  for (const [key, row] of by) {
    const m = master.get(key);
    const firstDue = [...row.byDate.keys()].sort()[0];
    // The master's payment days are the agreed terms; else what the orders carry.
    const terms = m?.payment_days != null ? Number(m.payment_days) : (row.terms.length ? row.terms[row.terms.length - 1] : 0);
    const h = headroom(m?.credit_limit ?? null, row.open);
    out.push({
      supplier: row.supplier, terms_days: terms, orders: row.orders, openOrders: row.openOrders,
      open: r2(row.open), awaiting: r2(row.awaiting),
      dueNow: r2(row.dueNow), due30: r2(row.due30), later: r2(row.later), undated: r2(row.undated),
      current: r2(row.current), od30: r2(row.od30), od60: r2(row.od60), od60plus: r2(row.od60plus),
      overdue: r2(row.od30 + row.od60 + row.od60plus), oldestDays: row.oldestDays,
      nextDue: firstDue ? { date: firstDue, amount: r2(row.byDate.get(firstDue)) } : null,
      limit: h.limit, available: h.headroom, utilisation: h.utilisation, over: h.over, near: h.near,
    });
  }
  return out.sort((a, b) => b.open - a.open || a.supplier.localeCompare(b.supplier));
}
