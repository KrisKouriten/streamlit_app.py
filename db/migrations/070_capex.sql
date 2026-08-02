-- Migration 070 — Capex Investment + Capital Allocation (PLAN)
-- A portfolio investment-appraisal engine generalised from the single-store model:
-- many projects (new store / refurb / warehouse / office / IT / distribution /
-- franchise / acquisition), each with its investment components and multi-year P&L
-- assumptions; the appraisal maths (NPV / IRR / payback / ROCE / FCF) is computed
-- by lib/capex-rules.js. A Capital Allocation position sits above the portfolio.
--
-- New `capex` schema. Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: DROP SCHEMA IF EXISTS capex CASCADE;

BEGIN;

CREATE SCHEMA IF NOT EXISTS capex;

CREATE TABLE IF NOT EXISTS capex.project (
  project_id        bigserial PRIMARY KEY,
  name              varchar(160) NOT NULL,
  investment_type   varchar(24) NOT NULL DEFAULT 'NEW_STORE',
  scenario_label    varchar(40) NOT NULL DEFAULT 'BASE',   -- BASE / OPTIMISTIC / DOWNSIDE / …
  store_code        varchar(30),
  entity_id         bigint,
  region            varchar(80),
  opening_date      date,
  owner             varchar(160),
  status            varchar(20) NOT NULL DEFAULT 'PLANNED', -- PLANNED / APPROVED / COMMITTED / ON_HOLD / COMPLETE
  priority          int,
  approval          varchar(40),
  -- Investment components (£)
  fit_out           numeric(18,2) NOT NULL DEFAULT 0,
  fixtures          numeric(18,2) NOT NULL DEFAULT 0,
  it                numeric(18,2) NOT NULL DEFAULT 0,
  inventory         numeric(18,2) NOT NULL DEFAULT 0,
  professional_fees numeric(18,2) NOT NULL DEFAULT 0,
  marketing         numeric(18,2) NOT NULL DEFAULT 0,
  working_capital   numeric(18,2) NOT NULL DEFAULT 0,
  contingency       numeric(18,2) NOT NULL DEFAULT 0,
  other             numeric(18,2) NOT NULL DEFAULT 0,
  -- Multi-year model assumptions
  years             int NOT NULL DEFAULT 10,
  year1_revenue     numeric(18,2),
  revenue_growth_pct numeric(9,4) NOT NULL DEFAULT 0,
  gross_margin_pct  numeric(9,4),
  payroll_pct       numeric(9,4),
  opex_pct          numeric(9,4),
  payroll_fixed     numeric(18,2),
  opex_fixed        numeric(18,2),
  depreciation_years int NOT NULL DEFAULT 7,
  depreciable_capex numeric(18,2),
  tax_rate          numeric(9,4) NOT NULL DEFAULT 0.25,
  discount_rate     numeric(9,4) NOT NULL DEFAULT 0.10,
  -- Delivery tracking (for capital allocation)
  committed_amount  numeric(18,2) NOT NULL DEFAULT 0,
  spent_amount      numeric(18,2) NOT NULL DEFAULT 0,
  behind_schedule   boolean NOT NULL DEFAULT false,
  over_budget       boolean NOT NULL DEFAULT false,
  notes             text,
  created_by        varchar(160),
  created_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_capex_project_status ON capex.project (status);

-- Capital Allocation position (single row per fiscal year).
CREATE TABLE IF NOT EXISTS capex.allocation (
  fiscal_year       int PRIMARY KEY,
  capital_available numeric(18,2) NOT NULL DEFAULT 0,
  cash_available    numeric(18,2) NOT NULL DEFAULT 0,
  hurdle_rate       numeric(9,4) NOT NULL DEFAULT 0.15,
  notes             text,
  updated_by        varchar(160),
  updated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
