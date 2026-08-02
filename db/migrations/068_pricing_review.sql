-- Migration 068 — Pricing Review (master pricing engine)
-- The single SKU-level pricing engine for the Finance OS, covering MINISO and
-- Local Purchase products. Holds the full cost build (RMB cost → FOB → freight →
-- landed → distribution → total cost → wholesale/distributor/retail) as INPUTS;
-- the derived prices, margins and the Pricing Health Score are computed by the
-- pure engine (lib/pricing-rules.js), not stored, so there is one source of truth.
--
-- KEY RULE: Air Freight is PART OF Freight — there is never a separate air-freight
-- adjustment. Total Freight = sea + air + duty + insurance + port + customs + other.
-- Landed Cost = GBP FOB + Total Freight.
--
-- New `pricing` schema (schema-per-domain). Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: DROP SCHEMA IF EXISTS pricing CASCADE;

BEGIN;

CREATE SCHEMA IF NOT EXISTS pricing;

-- The master price/cost build, one row per SKU × purchase channel.
CREATE TABLE IF NOT EXISTS pricing.sku_price (
  price_id             bigserial PRIMARY KEY,
  sku_code             varchar(60) NOT NULL,
  product_id           bigint,                 -- core.dim_product (optional link)
  channel_code         varchar(20) NOT NULL,   -- MINISO_MDS / LOCAL_PURCHASE
  -- Product attributes (denormalised for the grid; product_id is the canonical link)
  description          varchar(200),
  category             varchar(100),
  subcategory          varchar(100),
  brand                varchar(100),
  supplier             varchar(160),
  country              varchar(80),
  season               varchar(60),
  range                varchar(80),
  status               varchar(24) NOT NULL DEFAULT 'ACTIVE',
  launch_date          date,
  discontinue_date     date,
  -- Purchase
  rmb_cost             numeric(18,4) NOT NULL DEFAULT 0,
  discount_pct         numeric(9,4)  NOT NULL DEFAULT 0,   -- % off RMB cost
  fx_rate              numeric(14,6) NOT NULL DEFAULT 1,   -- RMB per GBP (e.g. 8.8)
  -- Freight components (GBP). Air freight lives HERE, inside freight.
  sea_freight          numeric(18,4) NOT NULL DEFAULT 0,
  air_freight          numeric(18,4) NOT NULL DEFAULT 0,
  duty                 numeric(18,4) NOT NULL DEFAULT 0,
  insurance            numeric(18,4) NOT NULL DEFAULT 0,
  port_charges         numeric(18,4) NOT NULL DEFAULT 0,
  customs              numeric(18,4) NOT NULL DEFAULT 0,
  other_import         numeric(18,4) NOT NULL DEFAULT 0,
  -- Distribution / warehouse (GBP)
  goods_in             numeric(18,4) NOT NULL DEFAULT 0,
  goods_out            numeric(18,4) NOT NULL DEFAULT 0,
  warehouse_storage    numeric(18,4) NOT NULL DEFAULT 0,
  warehouse_admin      numeric(18,4) NOT NULL DEFAULT 0,
  handling             numeric(18,4) NOT NULL DEFAULT 0,
  other_logistics      numeric(18,4) NOT NULL DEFAULT 0,
  -- Commercial margins & prices
  wholesale_margin_pct numeric(9,4) NOT NULL DEFAULT 0,    -- margin on selling price (0..1)
  distributor_margin_pct numeric(9,4) NOT NULL DEFAULT 0,
  retail_vat_pct       numeric(9,4) NOT NULL DEFAULT 0.20,
  actual_retail_price  numeric(18,4),           -- current live selling price (incl VAT)
  rrp                  numeric(18,4),           -- recommended retail price (incl VAT)
  promotional_price    numeric(18,4),
  markdown_price       numeric(18,4),
  -- Commercial targets
  target_gp_pct        numeric(9,4),            -- target gross margin for the health score
  notes                text,
  source_tag           varchar(30) NOT NULL DEFAULT 'MANUAL',
  updated_by           varchar(160),
  updated_at           timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pricing_sku ON pricing.sku_price (sku_code, channel_code);
CREATE INDEX IF NOT EXISTS ix_pricing_category ON pricing.sku_price (category);
CREATE INDEX IF NOT EXISTS ix_pricing_channel ON pricing.sku_price (channel_code);

COMMIT;
