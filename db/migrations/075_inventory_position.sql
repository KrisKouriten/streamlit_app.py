-- Migration 075 — the live inventory-position master (merch.inventory_position).
-- Inventory moves out of the per-OTB-version snapshot into a single live source that
-- the new Plan · HO → Inventory Position screen manages (stock in transit · Miniso
-- only, DC / warehouse, and store stock across all stores). OTB then reads a
-- consolidated topline from this master rather than ingesting its own copy — the
-- OTB process takes inventory over. Seeded from the existing sample positions so the
-- screen isn't empty on first open.
--
-- Additive and idempotent. Safe to re-run. Requires migration 065 (merch schema).
--
-- ROLLBACK: DROP TABLE merch.inventory_position;

BEGIN;

CREATE TABLE IF NOT EXISTS merch.inventory_position (
  id                  bigserial PRIMARY KEY,
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  location_type       varchar(20) NOT NULL,   -- STORE / WAREHOUSE / IN_TRANSIT
  store_code          varchar(30),            -- NULL for warehouse / in-transit
  store_name          varchar(120),
  units               numeric(20,4) NOT NULL DEFAULT 0,
  stock_value         numeric(20,2) NOT NULL DEFAULT 0,
  reserved_value      numeric(20,2) NOT NULL DEFAULT 0,   -- warehouse: reserved/allocated
  damaged_value       numeric(20,2) NOT NULL DEFAULT 0,   -- warehouse: damaged/quarantined
  confidence          numeric(9,4) NOT NULL DEFAULT 1.0,  -- in-transit arrival confidence
  stock_age_days      int,
  weeks_cover         numeric(12,4),
  data_through        date,
  source_tag          varchar(30) NOT NULL DEFAULT 'MANUAL',
  updated_by          varchar(160),
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_position
  ON merch.inventory_position (channel_code, location_type, COALESCE(store_code, ''));

-- Seed from the latest OTB version's positions (the sample seed) so the screen opens
-- with the illustrative inventory already in place. One row per channel/location/store.
INSERT INTO merch.inventory_position
  (channel_code, location_type, store_code, units, stock_value, reserved_value, damaged_value, confidence, stock_age_days, weeks_cover, data_through, source_tag, updated_by)
SELECT DISTINCT ON (ip.channel_code, ip.location_type, COALESCE(ip.store_code, ''))
  ip.channel_code, ip.location_type, ip.store_code, ip.units, ip.stock_value, ip.reserved_value,
  ip.damaged_value, ip.confidence, ip.stock_age_days, ip.weeks_cover, ip.data_through, 'SEED', 'system'
FROM merch.otb_inventory_position ip
WHERE NOT (ip.location_type = 'IN_TRANSIT' AND ip.channel_code <> 'MINISO_MDS')   -- in transit is Miniso only
ORDER BY ip.channel_code, ip.location_type, COALESCE(ip.store_code, ''), ip.otb_version_id DESC
ON CONFLICT (channel_code, location_type, COALESCE(store_code, '')) DO NOTHING;

COMMIT;
