-- Migration 013 — Operate forecast inputs + scenario planning (Phase 11)
-- The forecast workings from the two Q3-forecast models, as first-class inputs:
--   STORES       — forecast sales per store-month, variable rates (% of sales),
--                  fixed-cost schedules per store
--   HEAD_OFFICE  — monthly P&L lines (HO: nominals)
--   FRANCHISE    — monthly P&L lines (FR: nominals)
-- PLAN's scenario planning applies levers (sales / variable / fixed deltas) on
-- top of these inputs. Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.forecast_scenario;
--   DROP TABLE IF EXISTS finance.forecast_line;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.forecast_line (
  line_id     bigserial PRIMARY KEY,
  scope       varchar(12) NOT NULL CHECK (scope IN ('STORES','HEAD_OFFICE','FRANCHISE')),
  unit        varchar(80),                 -- store name for STORES; NULL otherwise
  line_label  varchar(120) NOT NULL,       -- the nominal, e.g. 'ST: Rent', 'HO: Freight'
  cost_type   varchar(14) NOT NULL CHECK (cost_type IN ('SALES','VARIABLE_RATE','FIXED')),
  ym          varchar(7),                  -- 'YYYY-MM'; NULL for constant VARIABLE_RATE
  value       numeric(20,6) NOT NULL,      -- £ for SALES/FIXED; rate (0–1) for VARIABLE_RATE
  source      varchar(80) NOT NULL DEFAULT 'MODEL',
  updated_by  varchar(120),
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_line_grain
  ON finance.forecast_line (scope, COALESCE(unit,''), line_label, cost_type, COALESCE(ym,''));
CREATE INDEX IF NOT EXISTS ix_forecast_line_scope_ym ON finance.forecast_line (scope, ym);

-- Scenario levers over the base inputs. Percent deltas: +0.05 = +5%.
CREATE TABLE IF NOT EXISTS finance.forecast_scenario (
  scenario_id   bigserial PRIMARY KEY,
  name          varchar(80) NOT NULL UNIQUE,
  sales_pct     numeric(9,4) NOT NULL DEFAULT 0,   -- forecast sales delta
  variable_pct  numeric(9,4) NOT NULL DEFAULT 0,   -- variable-rate delta (relative)
  fixed_pct     numeric(9,4) NOT NULL DEFAULT 0,   -- fixed-cost delta
  notes         text,
  created_by    varchar(120),
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active     boolean NOT NULL DEFAULT true
);

INSERT INTO finance.forecast_scenario (name, sales_pct, variable_pct, fixed_pct, notes, created_by)
VALUES
  ('Base',     0,     0,    0,    'The Operate forecast inputs as entered.', 'system'),
  ('Upside',   0.05,  0,    0,    'Sales +5% on base.', 'system'),
  ('Downside', -0.10, 0.02, 0.02, 'Sales −10%, variable rates +2%, fixed +2%.', 'system')
ON CONFLICT (name) DO NOTHING;

COMMIT;
