import { query } from "./db";
import { audit } from "./governance";

/*
 * KPI catalogue — the governed definitions behind every dashboard metric
 * (intelligence.dim_kpi). ADMIN/FINANCE master these: the name, how it is
 * calculated, its unit, which way is good, thresholds and owners. Every change
 * is audited (objectType "dim_kpi"). Mirrors the entity register pattern.
 */

export const DIRECTIONS = ["UP", "DOWN", "TARGET", "RANGE"];
export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];

const tableMissing = (e) => e?.code === "42P01";

export async function listKpis() {
  try {
    const { rows } = await query(
      `SELECT kpi_id, kpi_code, kpi_name, dashboard_domain, description, calculation_logic,
              unit_of_measure, favourable_direction, green_threshold, amber_threshold,
              frequency, business_owner, finance_owner, digital_colleague, is_active
       FROM intelligence.dim_kpi ORDER BY is_active DESC, dashboard_domain, kpi_name`
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

export async function createKpi(k, actor) {
  const { rows } = await query(
    `INSERT INTO intelligence.dim_kpi
       (kpi_code, kpi_name, dashboard_domain, description, calculation_logic, unit_of_measure,
        favourable_direction, green_threshold, amber_threshold, frequency, business_owner, finance_owner, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING kpi_id`,
    [k.code, k.name, k.domain || "GENERAL", k.description || null, k.calculation || "", k.unit || null,
     DIRECTIONS.includes(k.direction) ? k.direction : null, num(k.green), num(k.amber),
     k.frequency || null, k.businessOwner || null, k.financeOwner || null]
  );
  await audit({ actor, eventType: "kpi.create", objectType: "dim_kpi", objectRef: k.code, detail: { name: k.name } });
  return rows[0].kpi_id;
}

export async function updateKpi(kpiId, k, actor) {
  await query(
    `UPDATE intelligence.dim_kpi SET
       kpi_name = $2, dashboard_domain = $3, description = $4, calculation_logic = $5, unit_of_measure = $6,
       favourable_direction = $7, green_threshold = $8, amber_threshold = $9, frequency = $10,
       business_owner = $11, finance_owner = $12, is_active = $13
     WHERE kpi_id = $1`,
    [kpiId, k.name, k.domain || "GENERAL", k.description || null, k.calculation || "", k.unit || null,
     DIRECTIONS.includes(k.direction) ? k.direction : null, num(k.green), num(k.amber),
     k.frequency || null, k.businessOwner || null, k.financeOwner || null, k.isActive !== false]
  );
  await audit({ actor, eventType: "kpi.update", objectType: "dim_kpi", objectRef: String(kpiId), detail: { isActive: k.isActive !== false } });
}
