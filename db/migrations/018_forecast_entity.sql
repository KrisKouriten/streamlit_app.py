-- Migration 018 — forecast inputs: store → entity hierarchy (Phase 15)
-- Store forecast lines now carry the entity the store rolls up to (from the
-- Sales Forecast tab), so the forecast consolidates store → entity → group.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: ALTER TABLE finance.forecast_line DROP COLUMN IF EXISTS entity;

BEGIN;
ALTER TABLE finance.forecast_line ADD COLUMN IF NOT EXISTS entity varchar(120);
CREATE INDEX IF NOT EXISTS ix_forecast_line_entity ON finance.forecast_line (scope, entity);
COMMIT;
