-- ============================================================================
-- Migration 009 — Budget & Forecast plan model
--
-- Holds the multi-year plan from the Budget & Forecast workbook: the group P&L
-- (2025A / 2026 / 2027 / 2028), per-store forward-look, per-store monthly EBITDA,
-- group break-even and per-sq-ft KPIs. Each dataset is refreshed wholesale by CSV
-- upload (a dataset is cleared then re-loaded), so the tables are plain and the
-- app replaces rows per dataset.
--
-- Idempotent (CREATE ... IF NOT EXISTS). ROLLBACK: DROP the five tables.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS finance.plan_group_pl (
  id bigserial PRIMARY KEY, line_label varchar(80) NOT NULL, sort_order int NOT NULL DEFAULT 0,
  is_ratio boolean NOT NULL DEFAULT false,
  y2025a numeric(16,2), y2026 numeric(16,2), y2027 numeric(16,2), y2028 numeric(16,2), beta numeric(8,4)
);
CREATE TABLE IF NOT EXISTS finance.plan_store (
  id bigserial PRIMARY KEY, store_name varchar(120) NOT NULL, sort_order int NOT NULL DEFAULT 0,
  s2025 numeric(16,2), s2026 numeric(16,2), s2027 numeric(16,2), s2028 numeric(16,2),
  beta numeric(8,4), ebitda2028 numeric(16,2), ebitda_mgn numeric(8,4), s2030 numeric(16,2), trajectory varchar(24)
);
CREATE TABLE IF NOT EXISTS finance.plan_store_month (
  id bigserial PRIMARY KEY, store_name varchar(120) NOT NULL, ym char(7) NOT NULL, ebitda numeric(16,2)
);
CREATE INDEX IF NOT EXISTS ix_plan_month_store ON finance.plan_store_month (store_name, ym);
CREATE TABLE IF NOT EXISTS finance.plan_breakeven (
  id bigserial PRIMARY KEY, line_label varchar(80) NOT NULL, sort_order int NOT NULL DEFAULT 0,
  y2026 numeric(16,2), y2027 numeric(16,2), y2028 numeric(16,2)
);
CREATE TABLE IF NOT EXISTS finance.plan_kpi (
  id bigserial PRIMARY KEY, metric varchar(80) NOT NULL, sort_order int NOT NULL DEFAULT 0,
  y2026 numeric(16,2), y2027 numeric(16,2), y2028 numeric(16,2)
);

COMMIT;
