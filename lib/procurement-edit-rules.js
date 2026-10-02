/*
 * Editing a raised procurement order — pure, unit-tested in
 * tests/procurement-edit.test.mjs.
 *
 * What can change: supplier, reference, category, the amount (in the order's
 * currency), the order and delivery months, the Miniso pickup date and the
 * supplier payment date. The Miniso UK payment date is never edited: it is 180
 * days on the invoice / pickup date and drives the cash budget, so it moves
 * only when the order's own dates do.
 *
 * Locked: a cancelled order, one Finance have closed, and one already paid.
 *
 * Raising the amount on an order the head of department (or Finance) has
 * already approved sends it back for approval — the approval was for less.
 * Lowering it, or changing a date, keeps the approval.
 */

const YM = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v) => String(v ?? "").trim();
const money = (v) => {
  const c = clean(v).replace(/[£$€¥,\s]/g, "");
  if (c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function orderEditError(o = {}) {
  if (o.approval_status === "CANCELLED") return "This order is cancelled";
  if (o.finance_status === "CLOSED") return "Finance have closed this order — ask Finance to re-open it to change it";
  if (o.payment_status === "PAID" || o.status === "PAID") return "This order has been paid — it can't be changed";
  return null;
}

// The order's amount in its own currency (what was typed when it was raised).
export const orderAmount = (o = {}) => Number(o.amount_ccy ?? o.amount_gbp) || 0;

/*
 * order  the order as it stands
 * patch  { supplier, reference, category, amount, order_ym, delivery_ym,
 *          pickup_date, supplier_pay_date } — only the keys given change
 * → { error } | { changes: { field: value }, amountChanged, reapprove }
 */
export function planOrderEdit(order = {}, patch = {}) {
  const locked = orderEditError(order);
  if (locked) return { error: locked };
  const changes = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);

  if (has("supplier")) {
    const name = clean(patch.supplier).replace(/\s+/g, " ");
    if (!name) return { error: "Supplier is required" };
    if (name !== order.supplier) changes.supplier = name;
  }
  if (has("reference")) {
    const ref = clean(patch.reference) || null;
    if (ref !== (order.reference || null)) changes.reference = ref;
  }
  if (has("category")) {
    const cat = clean(patch.category) || null;
    if (cat !== (order.category || null)) changes.category = cat;
  }
  let amountChanged = false, reapprove = false;
  if (has("amount")) {
    const a = money(patch.amount);
    if (a == null || Number.isNaN(a) || !(a > 0)) return { error: "Enter an amount greater than zero" };
    const was = orderAmount(order);
    if (Math.abs(a - was) >= 0.005) {
      changes.amount = a;
      amountChanged = true;
      const approved = order.approval_status === "HOD_APPROVED" || order.approval_status === "APPROVED";
      reapprove = approved && a > was + 0.005;
    }
  }
  if (has("order_ym")) {
    const v = clean(patch.order_ym);
    if (!YM.test(v)) return { error: "Order month must be a month (YYYY-MM)" };
    if (v !== order.order_ym) changes.order_ym = v;
  }
  if (has("delivery_ym")) {
    const v = clean(patch.delivery_ym) || null;
    if (v && !YM.test(v)) return { error: "Delivery month must be a month (YYYY-MM)" };
    if (v !== (order.delivery_ym || null)) changes.delivery_ym = v;
  }
  if (has("pickup_date") && order.source === "MINISO") {
    const v = clean(patch.pickup_date).slice(0, 10);
    if (!DATE.test(v)) return { error: "A pickup date is required for Miniso HQ purchases" };
    if (v !== String(order.pickup_date || "").slice(0, 10)) changes.pickup_date = v;
  }
  if (has("supplier_pay_date")) {
    const v = clean(patch.supplier_pay_date).slice(0, 10) || null;
    if (v && !DATE.test(v)) return { error: "Supplier payment date must be a date" };
    if (v !== (String(order.supplier_pay_date || "").slice(0, 10) || null)) changes.supplier_pay_date = v;
  }
  return { changes, amountChanged, reapprove };
}
