-- 079_cost_model_rates.sql
-- Extends the store cost model to the full "Fixed, Variable and Labour Costs"
-- workbook:
--   * fixed costs gain a start month (a fixed line is only expected from then on)
--   * month-varying variable rates — the monthly COGS % override (absolute
--     month) and the seasonal labour chain (calendar month, repeats each year) —
--     live in store_cost_rate_month, resolved ahead of the flat annual rate.
-- Idempotent; safe to re-run.

BEGIN;

ALTER TABLE finance.store_cost_expectation
  ADD COLUMN IF NOT EXISTS start_ym char(7);   -- 'YYYY-MM'; fixed cost applies from this month

-- Month-varying variable rate for a store × nominal.
--   scope 'YM'    → an absolute month, period_key 'YYYY-MM' (e.g. monthly COGS %)
--   scope 'MONTH' → a calendar month, period_key 'MM' 01..12 (seasonal labour)
CREATE TABLE IF NOT EXISTS finance.store_cost_rate_month (
  store          text NOT NULL,
  line_label     text NOT NULL,
  scope          varchar(6) NOT NULL CHECK (scope IN ('YM','MONTH')),
  period_key     varchar(7) NOT NULL,
  pct_of_revenue numeric(12,8),
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_cost_rate_month
  ON finance.store_cost_rate_month (store, line_label, scope, period_key);

COMMIT;
