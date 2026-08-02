-- Migration 065 — Merchandising Open-to-Buy (OTB) model
-- The governed OTB model in a new `merch` schema (schema-per-domain convention).
-- OTB sits between the approved store sales forecast and the Procurement Tracker,
-- computed SEPARATELY for the two purchase channels (Miniso MDS / Local Purchase),
-- with every component of the calculation stored so the Remaining OTB is auditable
-- (never just the final number).
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: DROP SCHEMA IF EXISTS merch CASCADE;

BEGIN;

CREATE SCHEMA IF NOT EXISTS merch;

-- The two controlled purchase channels — the shared dimension that was previously
-- only a free-text enum on the cash procurement tracker.
CREATE TABLE IF NOT EXISTS merch.channel (
  channel_code varchar(20) PRIMARY KEY,   -- MINISO_MDS / LOCAL_PURCHASE
  channel_name varchar(80) NOT NULL,
  sort_order   int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true
);
INSERT INTO merch.channel (channel_code, channel_name, sort_order) VALUES
  ('MINISO_MDS',     'Miniso MDS',     1),
  ('LOCAL_PURCHASE', 'Local Purchase', 2)
ON CONFLICT (channel_code) DO NOTHING;

-- An OTB version links to the sales source it reconciles to (left unbound until
-- Finance confirms which stack is the approved source of truth), a scenario, the
-- inventory data-through date, and a lock lifecycle.
CREATE TABLE IF NOT EXISTS merch.otb_version (
  otb_version_id      bigserial PRIMARY KEY,
  label               varchar(120) NOT NULL,
  fiscal_year         int,
  sales_source        varchar(20) NOT NULL DEFAULT 'MANUAL',  -- PLANNING / FORECAST_VERSION / MANUAL
  plan_version_id     bigint,           -- planning.plan_version (when sales_source = PLANNING)
  forecast_version_id bigint,           -- finance.forecast_version (when sales_source = FORECAST_VERSION)
  scenario_code       varchar(20) NOT NULL DEFAULT 'BASE',
  inventory_through   date,
  status              varchar(20) NOT NULL DEFAULT 'DRAFT',    -- DRAFT / APPROVED / LOCKED / ARCHIVED
  approved_by         varchar(160),
  approved_at         timestamptz,
  notes               text,
  created_by          varchar(160),
  created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Store-level channel sales split (the reconciliation grain). Carries the approved
-- store sales it must reconcile to, the channel amount and the mix used.
CREATE TABLE IF NOT EXISTS merch.otb_store_sales (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  scenario_code       varchar(20) NOT NULL DEFAULT 'BASE',
  store_code          varchar(30) NOT NULL,
  period              char(7) NOT NULL,           -- YYYY-MM
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  sales_amount        numeric(20,2) NOT NULL DEFAULT 0,   -- channel forecast sales
  approved_store_sales numeric(20,2),                     -- approved total store sales (lineage)
  mix_pct             numeric(9,4),
  source              varchar(20) NOT NULL DEFAULT 'PCT_MIX',
  commentary          text,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_otb_store_sales
  ON merch.otb_store_sales (otb_version_id, scenario_code, store_code, period, channel_code);

-- Per-channel calculation levers (gross margin / cost-of-sales, freight, duty, FX,
-- target closing stock, clearance realisation, in-transit confidence, tolerance).
CREATE TABLE IF NOT EXISTS merch.otb_assumption (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  cos_rate            numeric(9,6),        -- cost of sales as a fraction of sales
  gross_margin_rate   numeric(9,6),        -- alternative to cos_rate (cos = 1 - gm)
  freight_pct         numeric(9,6) NOT NULL DEFAULT 0,
  duty_pct            numeric(9,6) NOT NULL DEFAULT 0,
  fx_rate             numeric(14,6) NOT NULL DEFAULT 1,
  target_stock_weeks  numeric(9,3),        -- target closing stock expressed as weeks of cover
  clearance_realisation numeric(9,4) NOT NULL DEFAULT 0.7,
  transit_confidence  numeric(9,4) NOT NULL DEFAULT 1.0,
  tolerance_pct       numeric(9,4) NOT NULL DEFAULT 1.0,
  tolerance_abs       numeric(20,2),
  notes               text,
  updated_by          varchar(160),
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_otb_assumption ON merch.otb_assumption (otb_version_id, channel_code);

-- Inventory position feeding OTB (uploaded — the app has no live stock feed yet).
-- Grain: version x channel x location (store or warehouse). Only genuinely
-- available stock reduces OTB, so reserved/damaged are held separately and
-- in-transit carries a confidence.
CREATE TABLE IF NOT EXISTS merch.otb_inventory_position (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  location_type       varchar(20) NOT NULL,   -- STORE / WAREHOUSE / IN_TRANSIT
  store_code          varchar(30),            -- NULL for warehouse / in-transit
  units               numeric(20,4) NOT NULL DEFAULT 0,
  stock_value         numeric(20,2) NOT NULL DEFAULT 0,
  reserved_value      numeric(20,2) NOT NULL DEFAULT 0,   -- warehouse: reserved/allocated
  damaged_value       numeric(20,2) NOT NULL DEFAULT 0,   -- warehouse: damaged/quarantined
  confidence          numeric(9,4) NOT NULL DEFAULT 1.0,  -- in-transit arrival confidence
  stock_age_days      int,
  weeks_cover         numeric(12,4),
  data_through        date,
  source_tag          varchar(30) NOT NULL DEFAULT 'UPLOAD',
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_otb_inventory
  ON merch.otb_inventory_position (otb_version_id, channel_code, location_type, COALESCE(store_code, ''));

-- Minimum stock-holding rules, resolved most-specific-first.
CREATE TABLE IF NOT EXISTS merch.min_stock_rule (
  id            bigserial PRIMARY KEY,
  level         varchar(20) NOT NULL,     -- COMPANY / STORE_TYPE / REGION / STORE / CATEGORY
  match_value   varchar(120),             -- store_code / store_format / region / category (NULL for COMPANY)
  channel_code  varchar(20),              -- NULL = all channels
  basis         varchar(20) NOT NULL,     -- UNITS / VALUE / WEEKS_COVER / DAYS / SALES_PCT
  amount        numeric(20,4) NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  updated_by    varchar(160),
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- New-store opening inventory investment (opening stock + fit-out INVENTORY only —
-- construction/fixtures capex is excluded from OTB).
CREATE TABLE IF NOT EXISTS merch.new_store_requirement (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  store_code          varchar(30),
  store_name          varchar(150),
  planned_opening     date,
  store_format        varchar(50),
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  opening_stock_value numeric(20,2) NOT NULL DEFAULT 0,
  fitout_inventory_value numeric(20,2) NOT NULL DEFAULT 0,   -- inventory, NOT construction capex
  phase               varchar(24) NOT NULL DEFAULT 'INITIAL', -- INITIAL / PRE_OPENING / OPENING_WEEK / FIRST_MONTH / MATURITY
  approved            boolean NOT NULL DEFAULT false,
  notes               text,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Store closures + residual stock. Only transferable/saleable stock reduces OTB.
CREATE TABLE IF NOT EXISTS merch.store_closure (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  store_code          varchar(30),
  closure_date        date,
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  current_stock_value numeric(20,2) NOT NULL DEFAULT 0,
  transferable_value  numeric(20,2) NOT NULL DEFAULT 0,
  non_transferable_value numeric(20,2) NOT NULL DEFAULT 0,
  write_off_value     numeric(20,2) NOT NULL DEFAULT 0,
  transfer_destination varchar(120),
  recovery_value      numeric(20,2),
  notes               text,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clearance strategy — aged/excess/closure stock worked before more is ordered.
-- Feeds OTB as an expected inventory reduction at a configurable realisation rate.
CREATE TABLE IF NOT EXISTS merch.clearance_plan (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  location            varchar(120),        -- store or warehouse
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  category            varchar(120),
  units               numeric(20,4) NOT NULL DEFAULT 0,
  stock_value         numeric(20,2) NOT NULL DEFAULT 0,
  stock_age_days      int,
  proposed_markdown_pct numeric(9,4),
  expected_units_cleared numeric(20,4),
  expected_revenue    numeric(20,2),
  expected_margin     numeric(20,2),
  realisation_rate    numeric(9,4) NOT NULL DEFAULT 0.7,
  start_date          date,
  end_date            date,
  status              varchar(20) NOT NULL DEFAULT 'PLANNED',
  owner               varchar(120),
  notes               text,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Open purchase commitments + approved-but-not-ordered requests consuming OTB.
CREATE TABLE IF NOT EXISTS merch.otb_commitment (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  period              char(7) NOT NULL,
  kind                varchar(20) NOT NULL,   -- OPEN_COMMITMENT / APPROVED_REQUEST
  amount              numeric(20,2) NOT NULL DEFAULT 0,
  reference           varchar(120),
  source              varchar(20) NOT NULL DEFAULT 'MANUAL',  -- PROCUREMENT / PO / MANUAL
  created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_otb_commitment ON merch.otb_commitment (otb_version_id, channel_code, period);

-- The auditable computed OTB — one row per component, per channel x period.
CREATE TABLE IF NOT EXISTS merch.otb_component (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  scenario_code       varchar(20) NOT NULL DEFAULT 'BASE',
  channel_code        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  period              char(7) NOT NULL,
  component_code      varchar(40) NOT NULL,   -- PLANNED_COS / TARGET_CLOSING_STOCK / NEW_STORE / FITOUT / OPENING_STORE_STOCK / OPENING_WAREHOUSE_STOCK / IN_TRANSIT / CLOSURE_TRANSFERABLE / OPEN_COMMITMENTS / APPROVED_REQUESTS / CLEARANCE_REDUCTION / ADJUSTMENTS / REMAINING_OTB
  amount              numeric(20,2) NOT NULL DEFAULT 0,
  lineage             jsonb,
  calc_at             timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_otb_component
  ON merch.otb_component (otb_version_id, scenario_code, channel_code, period, component_code);

-- Controlled OTB transfers between channels.
CREATE TABLE IF NOT EXISTS merch.otb_transfer (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  from_channel        varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  to_channel          varchar(20) NOT NULL REFERENCES merch.channel(channel_code),
  period              char(7) NOT NULL,
  amount              numeric(20,2) NOT NULL,
  reason              text,
  sales_mix_impact    text,
  margin_impact       text,
  cash_impact         text,
  requested_by        varchar(160),
  reviewer            varchar(160),
  approver            varchar(160),
  status              varchar(20) NOT NULL DEFAULT 'REQUESTED',  -- REQUESTED / APPROVED / REJECTED
  created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- OTB version approval / lock audit log.
CREATE TABLE IF NOT EXISTS merch.otb_approval (
  id                  bigserial PRIMARY KEY,
  otb_version_id      bigint NOT NULL REFERENCES merch.otb_version(otb_version_id) ON DELETE CASCADE,
  action              varchar(20) NOT NULL,   -- APPROVE / LOCK / REOPEN / ARCHIVE
  actor               varchar(160),
  note                text,
  at                  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
