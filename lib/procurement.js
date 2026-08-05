import { query } from "./db";
import { audit } from "./governance";
import { summarise, parseProcurementCsv, MINISO_TERMS_DAYS, cashOutFor, canDeleteProcurement } from "./procurement-rules.js";

const tableMissing = (e) => e?.code === "42P01" || e?.code === "42703";
const columnMissing = (e) => e?.code === "42703";

const ORDER_COLS = `purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag,
  pickup_date, delivery_ym, approval_status, hod_approved_by, hod_approved_at, fin_approved_by, fin_approved_at,
  cancelled_by, cancelled_at, cancel_reason, created_at`;

// Fetch the individual orders with their approval lifecycle. Degrades to the
// pre-082 columns (no approval fields → treated as APPROVED) so the page still
// works before the migration is run.
async function fetchOrders() {
  try {
    const { rows } = await query(`SELECT ${ORDER_COLS} FROM finance.procurement_purchase ORDER BY created_at DESC, purchase_id DESC`);
    return rows;
  } catch (e) {
    if (columnMissing(e)) {
      const { rows } = await query(`SELECT purchase_id, source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag, pickup_date, delivery_ym, 'APPROVED' AS approval_status, created_at FROM finance.procurement_purchase ORDER BY created_at DESC, purchase_id DESC`);
      return rows;
    }
    throw e;
  }
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

// Head of Department sign-off: PENDING → HOD_APPROVED.
export async function hodApproveProcurement(id, actor) {
  const { rows } = await query(
    `UPDATE finance.procurement_purchase SET approval_status = 'HOD_APPROVED', hod_approved_by = $2, hod_approved_at = CURRENT_TIMESTAMP
     WHERE purchase_id = $1 AND approval_status = 'PENDING' RETURNING purchase_id`, [id, actor]);
  if (!rows.length) throw new Error("Order not found, or it is not pending approval");
  await audit({ actor, eventType: "procurement.approve.hod", objectType: "procurement_purchase", objectRef: String(id), detail: {} });
  return { ok: true };
}

// Finance sign-off: PENDING or HOD_APPROVED → APPROVED.
export async function financeApproveProcurement(id, actor) {
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
export async function addProcurementPurchase({ source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym }, actor) {
  if (!["MINISO", "LOCAL"].includes(source)) throw new Error("Source must be Miniso or Local");
  if (!supplier || !supplier.trim()) throw new Error("Supplier is required");
  if (!/^\d{4}-\d{2}$/.test(order_ym || "")) throw new Error("Order month must be a YYYY-MM value");
  if (!Number.isFinite(Number(amount_gbp))) throw new Error("Amount must be a number");
  if (delivery_ym && !/^\d{4}-\d{2}$/.test(delivery_ym)) throw new Error("Delivery month must be a YYYY-MM value");
  const isMiniso = source === "MINISO";
  if (isMiniso && !/^\d{4}-\d{2}-\d{2}$/.test(pickup_date || "")) throw new Error("A pickup date is required for Miniso HQ purchases");
  const effectiveTerms = isMiniso ? MINISO_TERMS_DAYS : (Number(terms_days) || 0);
  await query(
    `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym, source_tag, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MANUAL',$11)`,
    [source, supplier.trim(), (category || "").trim() || null, order_ym, Number(amount_gbp), effectiveTerms,
     status === "PAID" ? "PAID" : "COMMITTED", (reference || "").trim() || null,
     isMiniso ? pickup_date : null, delivery_ym || null, actor]
  );
  await audit({ actor, eventType: "procurement.purchase.add", objectType: "procurement_purchase", objectRef: `${source}·${supplier}`, detail: { amount_gbp: Number(amount_gbp), order_ym, pickup_date: isMiniso ? pickup_date : null } });
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
