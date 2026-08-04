-- 078_store_cost_model.sql
-- Per-store fixed / variable cost expectation model. Uploaded on Data Uploads
-- and used by the Management Accounts Close accrual review as the *expected*
-- figure per store × nominal: FIXED costs carry a monthly £ amount, VARIABLE
-- costs a rate of that store's revenue. The month-end variance (expected −
-- actual posted) is the accrual estimate — a more precise basis than the
-- trailing run-rate, which stays the fallback where no model line is loaded.
-- Idempotent; safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS finance.store_cost_expectation (
  expectation_id   bigserial PRIMARY KEY,
  store            text NOT NULL,                 -- matches finance.mgmt_actual.unit
  line_label       text NOT NULL,                 -- nominal
  behaviour        varchar(10) NOT NULL CHECK (behaviour IN ('FIXED','VARIABLE')),
  monthly_amount   numeric(20,2),                 -- expected £ / month (FIXED)
  pct_of_revenue   numeric(9,6),                  -- expected rate as a fraction (VARIABLE)
  source           varchar(60) NOT NULL DEFAULT 'cost model workbook',
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One active expectation per store × nominal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_cost_expectation
  ON finance.store_cost_expectation (store, line_label);

COMMIT;
