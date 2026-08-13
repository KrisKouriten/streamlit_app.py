import { query } from "./db";
import { audit } from "./governance";
import { validateSupplier, summariseExposure, facilityHeadroom } from "./suppliers-rules.js";

/*
 * Suppliers & credit — DB layer over finance.supplier and finance.trade_facility_limit
 * (migration 090). Reads the canonical supplier list, upserts suppliers + credit
 * limits, and computes each supplier's open exposure (procurement + P.O
 * commitment + HSBC facility outstanding) matched by normalised name. Degrades
 * gracefully before the migration / before the source tables exist.
 */
const tableMissing = (e) => e?.code === "42P01" || e?.code === "42703";

export async function listSuppliers({ activeOnly = false } = {}) {
  const where = activeOnly ? "WHERE active" : "";
  const map = (rows) => rows.map((r) => ({
    ...r,
    credit_limit: r.credit_limit == null ? null : Number(r.credit_limit),
    payment_days: r.payment_days == null ? null : Number(r.payment_days),
    active_merch: r.active_merch === false ? false : true,
  }));
  try {
    // Prefer the migration-092 columns (payment_days, active_merch); fall back
    // to the base set before that migration is applied.
    try {
      const { rows } = await query(
        `SELECT supplier_id AS id, name, norm_name, source_type, currency, credit_limit, payment_days, active, active_merch
           FROM finance.supplier ${where} ORDER BY name`);
      return { ready: true, suppliers: map(rows) };
    } catch (e1) {
      if (e1?.code !== "42703") throw e1;   // pre-092: no payment_days / active_merch
      const { rows } = await query(
        `SELECT supplier_id AS id, name, norm_name, source_type, currency, credit_limit, active
           FROM finance.supplier ${where} ORDER BY name`);
      return { ready: true, suppliers: map(rows.map((r) => ({ ...r, payment_days: null, active_merch: true }))) };
    }
  } catch (e) {
    if (tableMissing(e)) return { ready: false, suppliers: [] };
    throw e;
  }
}

const uniqueViolation = (e) => e?.code === "23505";
const columnMissing = (e) => e?.code === "42703";

export async function upsertSupplier(input, actor) {
  const { clean, errors } = validateSupplier(input);
  if (errors.length) throw new Error(errors.join("; "));
  if (clean.id) {
    // A rename can collide with another supplier that already owns that
    // normalised name (the unique index) — surface a friendly message rather
    // than a raw DB error so the admin knows to merge instead.
    try {
      try {
        await query(
          `UPDATE finance.supplier SET name=$2, norm_name=$3, source_type=$4, currency=$5, credit_limit=$6, payment_days=$7, active=$8, active_merch=$9, notes=$10, updated_by=$11, updated_at=CURRENT_TIMESTAMP
             WHERE supplier_id=$1`,
          [clean.id, clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.payment_days, clean.active, clean.active_merch, clean.notes, actor]);
      } catch (e1) {
        if (!columnMissing(e1)) throw e1;   // pre-092: no payment_days / active_merch
        await query(
          `UPDATE finance.supplier SET name=$2, norm_name=$3, source_type=$4, currency=$5, credit_limit=$6, active=$7, notes=$8, updated_by=$9, updated_at=CURRENT_TIMESTAMP
             WHERE supplier_id=$1`,
          [clean.id, clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.active, clean.notes, actor]);
      }
    } catch (e) {
      if (uniqueViolation(e)) throw new Error(`Another supplier is already named “${clean.name}”. Rename or merge that one instead.`);
      throw e;
    }
    await audit({ actor, eventType: "supplier.update", objectType: "supplier", objectRef: String(clean.id), detail: { name: clean.name, credit_limit: clean.credit_limit } });
    return { id: clean.id };
  }
  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO finance.supplier (name, norm_name, source_type, currency, credit_limit, payment_days, active, active_merch, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (norm_name) DO UPDATE SET name=EXCLUDED.name, source_type=COALESCE(EXCLUDED.source_type, finance.supplier.source_type),
         credit_limit=EXCLUDED.credit_limit, currency=EXCLUDED.currency, payment_days=EXCLUDED.payment_days, active=EXCLUDED.active, active_merch=EXCLUDED.active_merch, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
       RETURNING supplier_id AS id`,
      [clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.payment_days, clean.active, clean.active_merch, clean.notes, actor]));
  } catch (e1) {
    if (!columnMissing(e1)) throw e1;       // pre-092 fallback
    ({ rows } = await query(
      `INSERT INTO finance.supplier (name, norm_name, source_type, currency, credit_limit, active, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (norm_name) DO UPDATE SET name=EXCLUDED.name, source_type=COALESCE(EXCLUDED.source_type, finance.supplier.source_type),
         credit_limit=EXCLUDED.credit_limit, currency=EXCLUDED.currency, active=EXCLUDED.active, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
       RETURNING supplier_id AS id`,
      [clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.active, clean.notes, actor]));
  }
  await audit({ actor, eventType: "supplier.create", objectType: "supplier", objectRef: String(rows[0].id), detail: { name: clean.name } });
  return { id: rows[0].id };
}

// A lightweight name → { source_type, active_merch } lookup keyed by normalised
// name, for the procurement rollup to classify + merch-filter its rows. Never
// throws; returns an empty Map before the supplier master exists.
// Remove a supplier from the master list. Suppliers are matched to procurement /
// P.O rows by name (not a foreign key), so deleting one only removes it from the
// master — existing purchases keep their supplier text. Finance/admin only.
export async function deleteSupplier(id, actor) {
  const supplierId = Number(id);
  if (!Number.isFinite(supplierId)) throw new Error("Choose a supplier to delete");
  const { rows } = await query(`DELETE FROM finance.supplier WHERE supplier_id = $1 RETURNING name`, [supplierId]);
  if (!rows.length) throw new Error("Supplier not found");
  await audit({ actor, eventType: "supplier.delete", objectType: "supplier", objectRef: String(supplierId), detail: { name: rows[0].name } });
  return { ok: true, name: rows[0].name };
}

export async function supplierMetaByNorm() {
  try {
    const list = await listSuppliers();
    if (!list.ready) return new Map();
    return new Map(list.suppliers.map((s) => [s.norm_name, { source_type: s.source_type, active_merch: s.active_merch }]));
  } catch { return new Map(); }
}

// One grouped sum keyed by normalised name; returns a Map(norm → gbp). Never throws.
async function sumBy(sql) {
  try {
    const { rows } = await query(sql);
    return new Map(rows.map((r) => [r.nn, Number(r.v) || 0]));
  } catch { return new Map(); }
}

// Per-supplier open exposure vs credit limit. Open commitment = procurement not
// yet PAID + P.O not rejected/cancelled; facility outstanding = HSBC GBP cash-out
// by beneficiary. Matched to the master on normalised name.
export async function supplierExposure() {
  const list = await listSuppliers();
  if (!list.ready) return { ready: false, rows: [], totals: null };
  const [proc, po, fac] = await Promise.all([
    sumBy(`SELECT lower(btrim(supplier)) AS nn, SUM(amount_gbp) AS v FROM finance.procurement_purchase WHERE status <> 'PAID' GROUP BY 1`),
    sumBy(`SELECT lower(btrim(supplier)) AS nn, SUM(payment_value) AS v FROM finance.purchase_order WHERE status NOT IN ('REJECTED','CANCELLED') GROUP BY 1`),
    sumBy(`SELECT lower(btrim(beneficiary)) AS nn, SUM(facility_payment_gbp) AS v FROM finance.bank_trade_facility GROUP BY 1`),
  ]);
  const rows = list.suppliers.map((s) => ({
    supplier_id: s.id, name: s.name, credit_limit: s.credit_limit,
    orderExposure: (proc.get(s.norm_name) || 0) + (po.get(s.norm_name) || 0),
    facilityOutstanding: fac.get(s.norm_name) || 0,
  }));
  return { ready: true, ...summariseExposure(rows) };
}

export async function getFacilityLimits() {
  try {
    const { rows } = await query(`SELECT facility, limit_gbp, notes, updated_at FROM finance.trade_facility_limit ORDER BY facility`);
    return rows.map((r) => ({ ...r, limit_gbp: r.limit_gbp == null ? null : Number(r.limit_gbp) }));
  } catch (e) { if (tableMissing(e)) return []; throw e; }
}

export async function setFacilityLimit({ facility, limit_gbp, notes }, actor) {
  const lim = limit_gbp == null || limit_gbp === "" ? null : Number(limit_gbp);
  if (lim != null && (!Number.isFinite(lim) || lim < 0)) throw new Error("Facility limit must be a positive number (or blank)");
  await query(
    `INSERT INTO finance.trade_facility_limit (facility, limit_gbp, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
     ON CONFLICT (facility) DO UPDATE SET limit_gbp=EXCLUDED.limit_gbp, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP`,
    [String(facility || "HSBC"), lim, notes || null, actor]);
  await audit({ actor, eventType: "facility.limit.set", objectType: "trade_facility_limit", objectRef: String(facility || "HSBC"), detail: { limit_gbp: lim } });
  return { ok: true };
}

// Facility headroom: the HSBC ceiling vs total GBP outstanding drawings.
export async function facilityPosition(facility = "HSBC") {
  const limits = await getFacilityLimits();
  const lim = limits.find((l) => l.facility === facility);
  const outstanding = await sumBy(`SELECT '${facility}' AS nn, SUM(facility_payment_gbp) AS v FROM finance.bank_trade_facility`);
  return { facility, ...facilityHeadroom(lim ? lim.limit_gbp : null, outstanding.get(facility) || 0) };
}
