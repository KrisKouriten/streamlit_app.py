-- Migration 089 — Business Project planned costs (Plan — HO)
-- Per-department PLANNED cost lines for a business project. The Projects
-- Dashboard and the project drill-down compare these planned costs against
-- ACTUAL P.O spend tagged to the project (finance.purchase_order.business_project_id,
-- migration 088) — planned vs actual, by department. Additive and idempotent.
--
-- ROLLBACK: DROP TABLE IF EXISTS finance.business_project_cost;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.business_project_cost (
  cost_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_project_id bigint NOT NULL REFERENCES finance.business_project(business_project_id) ON DELETE CASCADE,
  department          varchar(120),
  cost_line           varchar(200),
  amount              numeric(18,2) NOT NULL DEFAULT 0,   -- £ planned
  notes               text,
  created_by          varchar(160),
  updated_by          varchar(160),
  created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_business_project_cost_project ON finance.business_project_cost (business_project_id);

COMMIT;
