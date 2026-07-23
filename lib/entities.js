import { query } from "./db";
import { audit } from "./governance";

/*
 * Entity register. The legal entities Miniso UK consolidates. entity_name is the
 * house-style display ("Miniso UK — <location>"); legal_name is the exact
 * registered name used for statutory/Xero mapping. Xero connection status is
 * surfaced (read-only) from finance.xero_org_map. ADMIN/FINANCE manage these.
 */

export const ENTITY_TYPES = ["STORE", "FUNCTION", "HOLDING", "GROUP", "BRAND", "OTHER"];

export async function listEntities() {
  const { rows } = await query(
    `SELECT e.entity_id, e.entity_code, e.entity_name, e.legal_name, e.entity_type,
            e.currency_code, e.is_active,
            m.feed_status AS xero_status, m.xero_org_name, m.last_loaded_at
     FROM core.dim_entity e
     LEFT JOIN finance.xero_org_map m ON m.entity_id = e.entity_id
     ORDER BY e.is_active DESC, e.entity_name`
  );
  return rows;
}

export async function createEntity({ code, name, legalName, type }, actor) {
  const { rows } = await query(
    `INSERT INTO core.dim_entity (entity_code, entity_name, legal_name, entity_type, currency_code, is_active, valid_from)
     VALUES ($1,$2,$3,$4,'GBP',true,CURRENT_DATE) RETURNING entity_id`,
    [code, name, legalName || null, type || "OTHER"]
  );
  await audit({ actor, eventType: "entity.create", objectType: "dim_entity", objectRef: code, detail: { name } });
  return rows[0].entity_id;
}

export async function updateEntity(entityId, { name, legalName, type, isActive }, actor) {
  await query(
    `UPDATE core.dim_entity SET entity_name = $2, legal_name = $3, entity_type = $4, is_active = $5
     WHERE entity_id = $1`,
    [entityId, name, legalName || null, type || "OTHER", isActive !== false]
  );
  await audit({ actor, eventType: "entity.update", objectType: "dim_entity", objectRef: String(entityId), detail: { isActive } });
}
