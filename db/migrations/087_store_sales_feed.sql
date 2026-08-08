-- 087_store_sales_feed.sql
-- Self-serve upload for the daily Store Sales & KPI feed. The dashboards read an
-- extended shape of commercial.fact_store_sales / core.dim_store that, until now,
-- only existed after the external one-off "store-data load files" were run against
-- the database. This migration codifies that shape so a fresh database matches
-- production and the in-app uploader (lib/store-sales-import.js) has columns to
-- write to. Also seeds the canonical ACTUAL scenario the feed loads into.
-- Idempotent — safe to re-run and safe against a production DB that already has
-- these columns (ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING).

BEGIN;

-- Daily store fact: the KPI columns the Store Sales & KPI lib aggregates
-- (is_valid_day gate, gross transactions, returns count + value).
ALTER TABLE commercial.fact_store_sales
  ADD COLUMN IF NOT EXISTS is_valid_day        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transactions_gross  integer,
  ADD COLUMN IF NOT EXISTS return_transactions integer,
  ADD COLUMN IF NOT EXISTS return_value        numeric(20,2);

-- Store dimension: trading-window + established flag the LFL / like-for-like
-- and established-store calculations depend on.
ALTER TABLE core.dim_store
  ADD COLUMN IF NOT EXISTS first_trading_date  date,
  ADD COLUMN IF NOT EXISTS last_trading_date   date,
  ADD COLUMN IF NOT EXISTS is_established       boolean NOT NULL DEFAULT false;

-- Speeds up the feed's scenario+date window scans and the full-refresh delete.
CREATE INDEX IF NOT EXISTS idx_store_sales_scenario_date
  ON commercial.fact_store_sales (scenario_id, date_key);

-- Canonical ACTUAL scenario the daily feed loads into. The dashboard selects
-- actuals by scenario_type = 'ACTUAL' (not by code), so any pre-existing ACTUAL
-- store scenario keeps working; this only guarantees one exists on a fresh DB.
INSERT INTO core.dim_scenario (scenario_code, scenario_name, scenario_type, status)
VALUES ('STORE-ACT', 'Store Sales — Actual', 'ACTUAL', 'APPROVED')
ON CONFLICT (scenario_code) DO NOTHING;

COMMIT;
