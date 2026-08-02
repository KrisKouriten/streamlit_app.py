-- Migration 069 — Pricing Scenario planning (PLAN)
-- Version-controlled pricing scenarios that model a proposed change (promotion,
-- markdown, permanent change, clearance, multi-buy, premium) at SKU level BEFORE
-- implementation. A scenario NEVER overwrites live pricing (pricing.sku_price) —
-- it holds its own proposed prices and the maths (margin pre/post, blended margin
-- weighted by sales value, % of company/category/promotion sales) is computed by
-- lib/pricing-scenario-rules.js.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS pricing.scenario_line;
--   DROP TABLE IF EXISTS pricing.scenario;

BEGIN;

CREATE TABLE IF NOT EXISTS pricing.scenario (
  scenario_id    bigserial PRIMARY KEY,
  name           varchar(160) NOT NULL,
  scenario_type  varchar(20) NOT NULL DEFAULT 'PROMOTION',  -- PROMOTION / MARKDOWN / PERMANENT / CLEARANCE / MULTI_BUY / PREMIUM
  period_start   date,
  period_end     date,
  status         varchar(20) NOT NULL DEFAULT 'DRAFT',      -- DRAFT / APPROVED / ARCHIVED
  company_sales  numeric(20,2),                             -- company sales for the period (for % of company sales)
  notes          text,
  created_by     varchar(160),
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by    varchar(160),
  approved_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pricing.scenario_line (
  line_id                 bigserial PRIMARY KEY,
  scenario_id             bigint NOT NULL REFERENCES pricing.scenario(scenario_id) ON DELETE CASCADE,
  sku_code                varchar(60) NOT NULL,
  channel_code            varchar(20) NOT NULL,
  description             varchar(200),
  category                varchar(100),
  current_rrp             numeric(18,4),        -- incl VAT
  new_rrp                 numeric(18,4),        -- incl VAT (proposed)
  vat_rate                numeric(9,4) NOT NULL DEFAULT 0.20,
  cost_price              numeric(18,4),        -- total cost snapshot from the pricing master
  annual_sales            numeric(20,2),        -- baseline sales value (for weighting + % of sales)
  category_sales          numeric(20,2),        -- category sales value (for % of category)
  promotion_sales         numeric(20,2),        -- expected promotion sales value
  expected_sales_increase_pct numeric(9,4),
  baseline_units          numeric(20,2),
  expected_units          numeric(20,2),
  promo_start             date,
  promo_end               date,
  updated_at              timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_scenario_line ON pricing.scenario_line (scenario_id, sku_code, channel_code);

COMMIT;
