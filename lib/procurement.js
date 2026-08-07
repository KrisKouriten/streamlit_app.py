import { query } from "./db";
import { audit } from "./governance";
import { summarise, parseProcurementCsv, MINISO_TERMS_DAYS, cashOutFor, canDeleteProcurement } from "./procurement-rules.js";
import { getFxRates } from "./fx";
import { isForeignCurrency, findRate, convertToGbp, resolveApprovalFx } from "./fx-rules.js";

const tableMissing = (e) => e?.code === "42P01" || e?.code === "42703";
const columnMissing = (e) => e?.code === "42703";

const ORDER_COLS = `purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag,
  pickup_date, delivery_ym, currency, amount_ccy, cost_rate_type, cost_fx_rate, stock_rate_type, stock_fx_rate, stock_value_gbp,
  approval_status, hod_approved_by, hod_approved_at, fin_approved_by, fin_approved_at,
  cancelled_by, cancelled_at, cancel_reason, created_by, created_at`;

// Fetch the individual orders with their approval lifecycle. Degrades to the
// pre-082 columns (no approval fields → treated as APPROVED) so the page still
// works before the migration is run.
async function fetchOrders() {
  try {
    const { rows } = await query(`SELECT ${ORDER_COLS} FROM finance.procurement_purchase ORDER BY created_at DESC, purchase_id DESC`);
    return rows;
  } catch (e) {
    if (!columnMissing(e)) throw e;
  }
  // Pre-085: approval lifecycle present but no FX columns.
  try {
    const { rows } = await query(`SELECT purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag,
      pickup_date, delivery_ym, 'GBP' AS currency, amount_gbp AS amount_ccy, approval_status, hod_approved_by, hod_approved_at,
      fin_approved_by, fin_approved_at, cancelled_by, cancelled_at, cancel_reason, created_by, created_at
      FROM finance.procurement_purchase ORDER BY created_at DESC, purchase_id DESC`);
    return rows;
  } catch (e2) {
    if (!columnMissing(e2)) throw e2;
  }
  // Pre-082: no approval lifecycle either.
  const { rows } = await query(`SELECT purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag, pickup_date, delivery_ym, 'GBP' AS currency, amount_gbp AS amount_ccy, 'APPROVED' AS approval_status, created_by, created_at FROM finance.procurement_purchase ORDER BY created_at DESC, purchase_id DESC`);
  return rows;
}

export async function getProcurement() {
  try {
    const [orders, { rows: budgets }] = await Promise.all([
      fetchOrders(),
      query(`SELECT source, ym, budget_gbp FROM finance.procurement_budget`),
    ]);
    const illustrative = orders.length > 0 && orders.every((p) => p.source_tag === "ILLUSTRATIVE");
    // Cancelled orders are not a commitment — exclude from the cash summary.
    const active = orders.filter((p) => p.approval_status !== "CANCELLED");
    return { ready: true, loaded: orders.length > 0, illustrative, summary: summarise(active, budgets), rawCount: orders.length, orders };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, illustrative: false, summary: null, rawCount: 0, orders: [] };
    throw e;
  }
}

async function getOrderLine(id) {
  const { rows } = await query(`SELECT purchase_id, source, supplier, approval_status FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  return rows[0] || null;
}

// The currency + original-currency amount for an order (for the FX approval).
// Degrades to GBP when the FX columns are absent (pre-085).
async function getOrderFx(id) {
  try {
    const { rows } = await query(`SELECT currency, amount_ccy, amount_gbp FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
    const r = rows[0];
    if (!r) return null;
    return { currency: r.currency || "GBP", amountCcy: r.amount_ccy != null ? Number(r.amount_ccy) : Number(r.amount_gbp) };
  } catch (e) {
    if (columnMissing(e)) return { currency: "GBP", amountCcy: null };
    throw e;
  }
}

// Head of Department sign-off: PENDING → HOD_APPROVED.
export async function hodApproveProcurement(id, actor) {
  const { rows } = await query(
    `UPDATE finance.procurement_purchase SET approval_status = 'HOD_APPROVED', hod_approved_by = $2, hod_approved_at = CURRENT_TIMESTAMP
     WHERE purchase_id = $1 AND approval_status = 'PENDING' RETURNING purchase_id`, [id, actor]);
  if (!rows.length) throw new Error("Order not found, or it is not pending approval");
  await audit({ actor, eventType: "procurement.approve.hod", objectType: "procurement_purchase", objectRef: String(id), detail: {} });
  return { ok: true };
}

// Finance sign-off: PENDING or HOD_APPROVED → APPROVED. For a foreign-currency
// order Finance also picks the rate to settle in cashflow (actual cost → amount_gbp)
// and the rate to value stock on arrival (→ stock_value_gbp); the gap between the
// two is the FX gain/loss booked to P&L. A GBP order approves with no FX detail.
export async function financeApproveProcurement(id, actor, { cost_rate_type, stock_rate_type } = {}) {
  const fx = await getOrderFx(id);
  if (!fx) throw new Error("Order not found");

  if (isForeignCurrency(fx.currency)) {
    if (!cost_rate_type || !stock_rate_type) throw new Error("Pick both the actual-cost rate and the arrival valuation rate before approving");
    const rates = await getFxRates();
    const r = resolveApprovalFx({ currency: fx.currency, amountCcy: fx.amountCcy, costRateType: cost_rate_type, stockRateType: stock_rate_type, rates });
    if (r.cashflowGbp == null) throw new Error(`No ${cost_rate_type} rate is set for ${fx.currency} — set it on the Exchange rates tab first`);
    if (r.stockValueGbp == null) throw new Error(`No ${stock_rate_type} rate is set for ${fx.currency} — set it on the Exchange rates tab first`);
    const { rows } = await query(
      `UPDATE finance.procurement_purchase
         SET approval_status = 'APPROVED', fin_approved_by = $2, fin_approved_at = CURRENT_TIMESTAMP,
             amount_gbp = $3, cost_rate_type = $4, cost_fx_rate = $5, stock_rate_type = $6, stock_fx_rate = $7, stock_value_gbp = $8
       WHERE purchase_id = $1 AND approval_status IN ('PENDING','HOD_APPROVED') RETURNING purchase_id`,
      [id, actor, r.cashflowGbp, cost_rate_type, r.costRate, stock_rate_type, r.stockRate, r.stockValueGbp]);
    if (!rows.length) throw new Error("Order not found, or it is already approved / cancelled");
    await audit({ actor, eventType: "procurement.approve.finance", objectType: "procurement_purchase", objectRef: String(id),
      detail: { currency: fx.currency, cost_rate_type, stock_rate_type, cashflow_gbp: r.cashflowGbp, stock_value_gbp: r.stockValueGbp, fx_variance: r.fxVariance } });
    return { ok: true };
  }

  const { rows } = await query(
    `UPDATE finance.procurement_purchase SET approval_status = 'APPROVED', fin_approved_by = $2, fin_approved_at = CURRENT_TIMESTAMP
     WHERE purchase_id = $1 AND approval_status IN ('PENDING','HOD_APPROVED') RETURNING purchase_id`, [id, actor]);
  if (!rows.length) throw new Error("Order not found, or it is already approved / cancelled");
  await audit({ actor, eventType: "procurement.approve.finance", objectType: "procurement_purchase", objectRef: String(id), detail: {} });
  return { ok: true };
}

// Soft cancel — available to any procurement manager on a non-cancelled order.
export async function cancelProcurement(id, reason, actor) {
  const { rows } = await query(
    `UPDATE finance.procurement_purchase SET approval_status = 'CANCELLED', cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3
     WHERE purchase_id = $1 AND approval_status <> 'CANCELLED' RETURNING purchase_id`, [id, actor, (reason || "").trim() || null]);
  if (!rows.length) throw new Error("Order not found, or already cancelled");
  await audit({ actor, eventType: "procurement.cancel", objectType: "procurement_purchase", objectRef: String(id), detail: { reason: reason || null } });
  return { ok: true };
}

// Hard delete — Finance/admin only, gated on Head-of-Department approval.
export async function deleteProcurement(id, actor, { isFinance = false, isAdmin = false } = {}) {
  const line = await getOrderLine(id);
  if (!line) throw new Error("Order not found");
  const gate = canDeleteProcurement(line, { isFinance, isAdmin });
  if (!gate.ok) throw new Error(gate.reason);
  await query(`DELETE FROM finance.procurement_purchase WHERE purchase_id = $1`, [id]);
  await audit({ actor, eventType: "procurement.delete", objectType: "procurement_purchase", objectRef: String(id), detail: { supplier: line.supplier, status: line.approval_status } });
  return { ok: true };
}

// CSV upload replaces all manual/CSV purchases (keeps nothing stale); clears the
// illustrative seed on first real load.
export async function ingestProcurementCsv(csvText, actor) {
  const { records, errors } = parseProcurementCsv(csvText);
  if (!records.length) {
    const reason = errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).map((e) => `row ${e.row} ${e.reason}`).join("; ")}` : "no valid rows";
    throw new Error(`Purchases not loaded — ${reason}`);
  }
  await query(`DELETE FROM finance.procurement_purchase WHERE source_tag IN ('CSV upload','ILLUSTRATIVE')`);
  for (const r of records) {
    await query(
      `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CSV upload',$9)`,
      [r.source, r.supplier, r.category, r.order_ym, r.amount_gbp, r.terms_days, r.status, r.reference, actor]
    );
  }
  await audit({ actor, eventType: "procurement.upload", objectType: "procurement_purchase", objectRef: "csv", detail: { loaded: records.length, rowErrors: errors.length } });
  return { loaded: records.length, errors };
}

// Add a single purchase line directly (no CSV). Tagged 'MANUAL' so it survives a
// later CSV upload (which only replaces 'CSV upload'/'ILLUSTRATIVE' rows).
// Miniso HQ buys on fixed 180-day terms from the goods pickup date, so a pickup
// date is required and the terms are forced to 180; Local keeps its entered terms.
export async function addProcurementPurchase({ source, supplier, category, order_ym, amount_gbp, currency, terms_days, status, reference, pickup_date, delivery_ym }, actor) {
  if (!["MINISO", "LOCAL"].includes(source)) throw new Error("Source must be Miniso or Local");
  if (!supplier || !supplier.trim()) throw new Error("Supplier is required");
  if (!/^\d{4}-\d{2}$/.test(order_ym || "")) throw new Error("Order month must be a YYYY-MM value");
  if (!Number.isFinite(Number(amount_gbp))) throw new Error("Amount must be a number");
  if (delivery_ym && !/^\d{4}-\d{2}$/.test(delivery_ym)) throw new Error("Delivery month must be a YYYY-MM value");
  const isMiniso = source === "MINISO";
  if (isMiniso && !/^\d{4}-\d{2}-\d{2}$/.test(pickup_date || "")) throw new Error("A pickup date is required for Miniso HQ purchases");
  const effectiveTerms = isMiniso ? MINISO_TERMS_DAYS : (Number(terms_days) || 0);

  // The entered amount is in the order currency. GBP passes straight through; a
  // foreign order is converted to a provisional GBP figure at the current SPOT
  // rate for the cash budget, then re-struck on approval at the chosen rate.
  const ccy = String(currency || "GBP").toUpperCase();
  const amountCcy = Number(amount_gbp);
  let amountGbp = amountCcy;
  if (isForeignCurrency(ccy)) {
    const spot = findRate(await getFxRates(), ccy, "SPOT");
    const conv = convertToGbp(amountCcy, spot);
    if (conv == null) throw new Error(`No SPOT rate is set for ${ccy} — set it on the Exchange rates tab first`);
    amountGbp = conv;
  }

  const common = [source, supplier.trim(), (category || "").trim() || null, order_ym, amountGbp, effectiveTerms,
    status === "PAID" ? "PAID" : "COMMITTED", (reference || "").trim() || null,
    isMiniso ? pickup_date : null, delivery_ym || null, actor];
  try {
    await query(
      `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym, created_by, currency, amount_ccy, source_tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'MANUAL')`,
      [...common, ccy, amountCcy]
    );
  } catch (e) {
    if (!columnMissing(e)) throw e;              // pre-085: no currency/amount_ccy columns
    await query(
      `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym, created_by, source_tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'MANUAL')`,
      common
    );
  }
  await audit({ actor, eventType: "procurement.purchase.add", objectType: "procurement_purchase", objectRef: `${source}·${supplier}`, detail: { amount_ccy: amountCcy, currency: ccy, amount_gbp: amountGbp, order_ym, pickup_date: isMiniso ? pickup_date : null } });
  return { ok: true };
}

export async function setBudget({ source, ym, budget }, actor) {
  await query(
    `INSERT INTO finance.procurement_budget (source, ym, budget_gbp, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (source, ym) DO UPDATE SET budget_gbp = EXCLUDED.budget_gbp, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [source, ym, budget, actor]
  );
  await audit({ actor, eventType: "procurement.budget", objectType: "procurement_budget", objectRef: `${source}·${ym}`, detail: { budget } });
}
