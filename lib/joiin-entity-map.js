import { query } from "./db";
import { ENTITY_ID } from "./entity-map.js";
import { resolveEntityMap } from "./entity-map-rules.js";

/*
 * Joiin entity map — DB layer. The effective company-name → Joiin-id map comes
 * from finance.joiin_entity_map, falling back to the hardcoded ENTITY_ID seed
 * if the table is absent (migration 031 not run) or empty. See
 * entity-map-rules.resolveEntityMap for the resolution logic.
 */

const tableMissing = (e) => e?.code === "42P01";

// The effective { entityName: joiinId } map used by the refresh and ingest.
export async function getEntityMap() {
  try {
    const { rows } = await query(
      `SELECT entity_name, joiin_id, active FROM finance.joiin_entity_map ORDER BY sort_order, entity_name`
    );
    return resolveEntityMap(ENTITY_ID, rows, true);
  } catch (e) {
    if (tableMissing(e)) return resolveEntityMap(ENTITY_ID, [], false); // pre-migration: use the seed
    throw e;
  }
}

// Full rows for an admin view. Falls back to presenting the seed as rows if the
// table hasn't been created yet, so the screen always shows the live map.
export async function listEntityMap() {
  try {
    const { rows } = await query(
      `SELECT entity_name, joiin_id, scope, active, sort_order FROM finance.joiin_entity_map ORDER BY active DESC, sort_order, entity_name`
    );
    return { ready: true, rows };
  } catch (e) {
    if (tableMissing(e)) {
      const rows = Object.entries(ENTITY_ID).map(([entity_name, joiin_id]) => ({ entity_name, joiin_id, scope: null, active: true, sort_order: 0 }));
      return { ready: false, rows };
    }
    throw e;
  }
}

export async function upsertEntityMapping({ entity_name, joiin_id, scope = null, active = true, sort_order = 0 }) {
  if (!entity_name?.trim() || !joiin_id?.trim()) throw new Error("Both the company name and Joiin id are required");
  await query(
    `INSERT INTO finance.joiin_entity_map (entity_name, joiin_id, scope, active, sort_order, updated_at)
     VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
     ON CONFLICT (entity_name) DO UPDATE SET joiin_id = EXCLUDED.joiin_id, scope = EXCLUDED.scope,
       active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = CURRENT_TIMESTAMP`,
    [entity_name.trim(), joiin_id.trim(), scope, active, sort_order]
  );
}

export async function deleteEntityMapping(entity_name) {
  await query(`DELETE FROM finance.joiin_entity_map WHERE entity_name = $1`, [entity_name]);
}
