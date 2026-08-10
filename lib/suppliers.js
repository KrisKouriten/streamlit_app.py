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
  try {
    const { rows } = await query(
      `SELECT supplier_id AS id, name, norm_name, source_type, currency, credit_limit, active
         FROM finance.supplier ${activeOnly ? "WHERE active" : ""} ORDER BY name`);
    return { ready: true, suppliers: rows.map((r) => ({ ...r, credit_limit: r.credit_limit == null ? null : Number(r.credit_limit) })) };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, suppliers: [] };
    throw e;
  }
}

export async function upsertSupplier(input, actor) {
  const { clean, errors } = validateSupplier(input);
  if (errors.length) throw new Error(errors.join("; "));
  if (clean.id) {
    await query(
      `UPDATE finance.supplier SET name=$2, norm_name=$3, source_type=$4, currency=$5, credit_limit=$6, active=$7, notes=$8, updated_by=$9, updated_at=CURRENT_TIMESTAMP
         WHERE supplier_id=$1`,
      [clean.id, clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.active, clean.notes, actor]);
    await audit({ actor, eventType: "supplier.update", objectType: "supplier", objectRef: String(clean.id), detail: { name: clean.name, credit_limit: clean.credit_limit } });
    return { id: clean.id };
  }
  const { rows } = await query(
    `INSERT INTO finance.supplier (name, norm_name, source_type, currency, credit_limit, active, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (norm_name) DO UPDATE SET name=EXCLUDED.name, source_type=COALESCE(finance.supplier.source_type, EXCLUDED.source_type),
       credit_limit=EXCLUDED.credit_limit, currency=EXCLUDED.currency, active=EXCLUDED.active, notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING supplier_id AS id`,
    [clean.name, clean.norm_name, clean.source_type, clean.currency, clean.credit_limit, clean.active, clean.notes, actor]);
  await audit({ actor, eventType: "supplier.create", objectType: "supplier", objectRef: String(rows[0].id), detail: { name: clean.name } });
  return { id: rows[0].id };
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
