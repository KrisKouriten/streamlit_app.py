/*
 * Inventory Position — the live inventory master (migration 075). A single source
 * of the stock position across the three locations (stock in transit · Miniso only,
 * DC / warehouse, and store stock across all stores), managed on the Plan · HO →
 * Inventory Position screen. The OTB engine reads a consolidated topline from here
 * rather than ingesting its own per-version copy. Parsing reuses the pure
 * parseInventoryCsv; the writes + summary are the DB side. Degrades to []/empty
 * before migration 075 is applied.
 */

import { query } from "./db";
import { audit } from "./governance";
import { parseInventoryCsv } from "./inventory-ingest-rules.js";
import { availableWarehouse, inTransitAvailable, OTB_CHANNELS, CHANNEL_LABEL } from "./otb-rules.js";

const absent = (e) => e?.code === "42P01" || e?.code === "42703" || e?.code === "3F000";
const actorOf = (a) => a?.email || a?.name || "system";
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { if (absent(e)) return fallback; throw e; } };

const COLS = `id, channel_code, location_type, store_code, store_name, units, stock_value, reserved_value,
  damaged_value, confidence, stock_age_days, weeks_cover, data_through, source_tag, updated_by, updated_at`;

// The three locations, in display order. In transit is Miniso-only.
export const INVENTORY_LOCATIONS = [
  { code: "IN_TRANSIT", label: "Stock in transit", minisoOnly: true },
  { code: "WAREHOUSE", label: "Stock in the DC", minisoOnly: false },
  { code: "STORE", label: "Stock in stores", minisoOnly: false },
];

export async function listInventoryPositions({ locationType = null, channel = null } = {}) {
  return safe(async () => (await query(
    `SELECT ${COLS} FROM merch.inventory_position
      WHERE ($1::varchar IS NULL OR location_type = $1)
        AND ($2::varchar IS NULL OR channel_code = $2)
      ORDER BY channel_code, location_type, store_code NULLS FIRST, id`,
    [locationType, channel])).rows, []);
}

export async function saveInventoryPosition(r, actor) {
  if (!OTB_CHANNELS.includes(r.channel_code)) throw new Error("Choose a valid channel");
  const loc = String(r.location_type || "").toUpperCase();
  if (!["STORE", "WAREHOUSE", "IN_TRANSIT"].includes(loc)) throw new Error("Location must be STORE, WAREHOUSE or IN_TRANSIT");
  if (loc === "IN_TRANSIT" && r.channel_code !== "MINISO_MDS") throw new Error("Stock in transit is tracked for Miniso only");
  const storeCode = loc === "STORE" ? (r.store_code || null) : null;
  const n = (v) => (v == null || v === "" ? 0 : Number(v));
  const { rows } = await query(
    `INSERT INTO merch.inventory_position (channel_code, location_type, store_code, store_name, units, stock_value, reserved_value, damaged_value, confidence, stock_age_days, weeks_cover, data_through, source_tag, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'MANUAL',$13,CURRENT_TIMESTAMP)
     ON CONFLICT (channel_code, location_type, COALESCE(store_code, '')) DO UPDATE SET
       store_name = EXCLUDED.store_name, units = EXCLUDED.units, stock_value = EXCLUDED.stock_value,
       reserved_value = EXCLUDED.reserved_value, damaged_value = EXCLUDED.damaged_value, confidence = EXCLUDED.confidence,
       stock_age_days = EXCLUDED.stock_age_days, weeks_cover = EXCLUDED.weeks_cover, data_through = EXCLUDED.data_through,
       source_tag = 'MANUAL', updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [r.channel_code, loc, storeCode, r.store_name || null, n(r.units), n(r.stock_value), n(r.reserved_value),
     n(r.damaged_value), r.confidence == null || r.confidence === "" ? 1 : Number(r.confidence),
     r.stock_age_days == null || r.stock_age_days === "" ? null : Math.round(Number(r.stock_age_days)),
     r.weeks_cover == null || r.weeks_cover === "" ? null : Number(r.weeks_cover), r.data_through || null, actorOf(actor)]);
  await audit({ actor, eventType: "inventory.position.save", objectType: "inventory_position", objectRef: String(rows[0].id), detail: { channel: r.channel_code, location: loc } });
  return { ok: true, id: rows[0].id };
}

export async function deleteInventoryPosition(id, actor) {
  await query(`DELETE FROM merch.inventory_position WHERE id = $1`, [id]);
  await audit({ actor, eventType: "inventory.position.delete", objectType: "inventory_position", objectRef: String(id) });
  return { ok: true };
}

// Bulk ingest an inventory CSV — upserts each row into the master. Reuses the pure
// parser shared with the OTB ingest. In-transit rows for non-Miniso channels are
// skipped (in transit is Miniso-only).
export async function ingestInventoryPositions(csvText, actor) {
  const { rows, errors } = parseInventoryCsv(csvText);
  if (!rows.length) throw new Error(errors[0] || "No inventory rows found in the file");
  let loaded = 0; const skipped = [...errors];
  for (const r of rows) {
    if (r.location_type === "IN_TRANSIT" && r.channel_code !== "MINISO_MDS") { skipped.push(`Skipped in-transit ${r.channel_code} (Miniso only)`); continue; }
    await query(
      `INSERT INTO merch.inventory_position (channel_code, location_type, store_code, units, stock_value, reserved_value, damaged_value, confidence, stock_age_days, weeks_cover, data_through, source_tag, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UPLOAD',$12,CURRENT_TIMESTAMP)
       ON CONFLICT (channel_code, location_type, COALESCE(store_code, '')) DO UPDATE SET
         units = EXCLUDED.units, stock_value = EXCLUDED.stock_value, reserved_value = EXCLUDED.reserved_value,
         damaged_value = EXCLUDED.damaged_value, confidence = EXCLUDED.confidence, stock_age_days = EXCLUDED.stock_age_days,
         weeks_cover = EXCLUDED.weeks_cover, data_through = EXCLUDED.data_through, source_tag = 'UPLOAD',
         updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [r.channel_code, r.location_type, r.store_code, r.units, r.stock_value, r.reserved_value,
       r.damaged_value, r.confidence, r.stock_age_days, r.weeks_cover, r.data_through, actorOf(actor)]);
    loaded++;
  }
  await audit({ actor, eventType: "inventory.position.ingest", objectType: "inventory_position", objectRef: "csv", detail: { loaded, skipped: skipped.length } });
  return { ok: true, loaded, warnings: skipped };
}

/*
 * The consolidated topline the OTB engine consumes and the Inventory summary shows:
 * per channel × location, the available value that feeds OTB (warehouse nets
 * reserved/damaged; in-transit is confidence-adjusted; stores are consolidated to a
 * single total — no per-store detail). Also returns per-channel and grand totals.
 */
export async function getInventorySummary() {
  const rows = await listInventoryPositions();
  const dataThrough = rows.reduce((max, r) => (r.data_through && (!max || r.data_through > max) ? r.data_through : max), null);
  const byChannel = {};
  for (const ch of OTB_CHANNELS) {
    byChannel[ch] = {
      channel_code: ch, label: CHANNEL_LABEL[ch] || ch,
      STORE: { gross: 0, available: 0, storeCount: 0 },
      WAREHOUSE: { gross: 0, available: 0, reserved: 0, damaged: 0 },
      IN_TRANSIT: { gross: 0, available: 0 },
    };
  }
  for (const r of rows) {
    const b = byChannel[r.channel_code];
    if (!b) continue;
    const value = Number(r.stock_value) || 0;
    if (r.location_type === "STORE") {
      b.STORE.gross += value; b.STORE.available += value; b.STORE.storeCount += 1;
    } else if (r.location_type === "WAREHOUSE") {
      b.WAREHOUSE.gross += value;
      b.WAREHOUSE.reserved += Number(r.reserved_value) || 0;
      b.WAREHOUSE.damaged += Number(r.damaged_value) || 0;
      b.WAREHOUSE.available += availableWarehouse({ stockValue: r.stock_value, reservedValue: r.reserved_value, damagedValue: r.damaged_value });
    } else if (r.location_type === "IN_TRANSIT") {
      b.IN_TRANSIT.gross += value;
      b.IN_TRANSIT.available += inTransitAvailable({ value: r.stock_value, confidence: r.confidence });
    }
  }
  const channels = OTB_CHANNELS.map((ch) => {
    const b = byChannel[ch];
    const available = round2(b.STORE.available + b.WAREHOUSE.available + b.IN_TRANSIT.available);
    return {
      ...b,
      STORE: { ...b.STORE, gross: round2(b.STORE.gross), available: round2(b.STORE.available) },
      WAREHOUSE: { ...b.WAREHOUSE, gross: round2(b.WAREHOUSE.gross), available: round2(b.WAREHOUSE.available), reserved: round2(b.WAREHOUSE.reserved), damaged: round2(b.WAREHOUSE.damaged) },
      IN_TRANSIT: { ...b.IN_TRANSIT, gross: round2(b.IN_TRANSIT.gross), available: round2(b.IN_TRANSIT.available) },
      totalAvailable: available,
    };
  });
  const grand = {
    store: round2(channels.reduce((t, c) => t + c.STORE.available, 0)),
    warehouse: round2(channels.reduce((t, c) => t + c.WAREHOUSE.available, 0)),
    inTransit: round2(channels.reduce((t, c) => t + c.IN_TRANSIT.available, 0)),
    total: round2(channels.reduce((t, c) => t + c.totalAvailable, 0)),
    storeCount: channels.reduce((t, c) => t + c.STORE.storeCount, 0),
  };
  return { ready: true, loaded: rows.length > 0, dataThrough, channels, grand };
}
