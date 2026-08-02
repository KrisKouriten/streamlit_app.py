/*
 * OTB inventory ingest. The platform has no live stock feed, so merchandising
 * uploads the inventory position (store stock, warehouse stock, stock in transit)
 * that OTB consumes. This parses a CSV and upserts merch.otb_inventory_position
 * for an OTB version, and stamps the version's inventory-through date. The parsing
 * is pure (parseInventoryCsv) so it is unit-tested; the write is the DB side.
 */

import { query } from "./db";
import { audit } from "./governance";
import { parseInventoryCsv } from "./inventory-ingest-rules.js";

const actorOf = (a) => a?.email || a?.name || "system";

// Ingest an inventory CSV for an OTB version. Replaces the version's positions and
// stamps its inventory-through date to the latest data_through seen.
export async function ingestInventory(versionId, csvText, actor) {
  const { rows, errors } = parseInventoryCsv(csvText);
  if (!rows.length) throw new Error(errors[0] || "No inventory rows found in the file");
  await query(`DELETE FROM merch.otb_inventory_position WHERE otb_version_id = $1`, [versionId]);
  let latest = null;
  for (const r of rows) {
    await query(
      `INSERT INTO merch.otb_inventory_position (otb_version_id, channel_code, location_type, store_code, units, stock_value, reserved_value, damaged_value, confidence, stock_age_days, weeks_cover, data_through, source_tag, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UPLOAD',CURRENT_TIMESTAMP)
       ON CONFLICT (otb_version_id, channel_code, location_type, COALESCE(store_code, '')) DO UPDATE SET
         units = EXCLUDED.units, stock_value = EXCLUDED.stock_value, reserved_value = EXCLUDED.reserved_value,
         damaged_value = EXCLUDED.damaged_value, confidence = EXCLUDED.confidence, stock_age_days = EXCLUDED.stock_age_days,
         weeks_cover = EXCLUDED.weeks_cover, data_through = EXCLUDED.data_through, updated_at = CURRENT_TIMESTAMP`,
      [versionId, r.channel_code, r.location_type, r.store_code, r.units, r.stock_value, r.reserved_value,
       r.damaged_value, r.confidence, r.stock_age_days, r.weeks_cover, r.data_through]);
    if (r.data_through && (!latest || r.data_through > latest)) latest = r.data_through;
  }
  if (latest) await query(`UPDATE merch.otb_version SET inventory_through = $2, updated_at = CURRENT_TIMESTAMP WHERE otb_version_id = $1`, [versionId, latest]);
  await audit({ actor, eventType: "otb.inventory.ingest", objectType: "otb_version", objectRef: String(versionId), detail: { rows: rows.length, dataThrough: latest } });
  return { ok: true, rows: rows.length, warnings: errors, dataThrough: latest };
}
