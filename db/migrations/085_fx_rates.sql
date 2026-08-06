-- 085_fx_rates.sql
-- Foreign-currency procurement. Miniso HQ orders are raised in USD, so a purchase
-- carries its own currency and original-currency amount, and Finance holds three
-- USD→GBP rates it converts at:
--   SPOT    — the rate paid at the point in time
--   HEDGED  — the rate locked in when hedging with HSBC
--   COSTING — the rate stock is valued at
-- On approval Finance picks the rate to settle in cashflow (actual cost) and the
-- rate to value stock on arrival; the gap between the two lands on the P&L.
-- Rates are quoted as foreign units per £1 (GBPUSD, e.g. 1.2700), so
-- GBP = amount ÷ rate. USD only for now; the table generalises to more later.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS finance.fx_rate (
  currency    varchar(3)  NOT NULL,                 -- ISO code of the foreign currency
  rate_type   varchar(10) NOT NULL,                 -- SPOT | HEDGED | COSTING
  rate        numeric(14,6),                        -- foreign units per £1 (GBPccy)
  note        text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (currency, rate_type)
);

DO $$ BEGIN
  ALTER TABLE finance.fx_rate
    ADD CONSTRAINT fx_rate_type_chk CHECK (rate_type IN ('SPOT','HEDGED','COSTING'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the three USD rate types with a placeholder GBPUSD so the feature works
-- out of the box; Finance overwrites each with the live rate.
INSERT INTO finance.fx_rate (currency, rate_type, rate, note, updated_by)
VALUES
  ('USD', 'SPOT',    1.270000, 'Placeholder — update with the live spot rate', 'seed'),
  ('USD', 'HEDGED',  1.270000, 'Placeholder — update with the HSBC hedged rate', 'seed'),
  ('USD', 'COSTING', 1.270000, 'Placeholder — update with the stock costing rate', 'seed')
ON CONFLICT (currency, rate_type) DO NOTHING;

-- FX detail on a purchase. `currency` already exists (066); default it and add
-- the original-currency amount, the two chosen rate types + rates, and the
-- resulting GBP stock valuation. `amount_gbp` remains the cashflow figure.
ALTER TABLE finance.procurement_purchase
  ALTER COLUMN currency SET DEFAULT 'GBP';

UPDATE finance.procurement_purchase SET currency = 'GBP' WHERE currency IS NULL;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS amount_ccy      numeric(18,2),   -- amount in the order currency (= amount_gbp when GBP)
  ADD COLUMN IF NOT EXISTS cost_rate_type  varchar(10),     -- rate type settled in cashflow (actual cost)
  ADD COLUMN IF NOT EXISTS cost_fx_rate    numeric(14,6),   -- the rate pulled at approval for cashflow
  ADD COLUMN IF NOT EXISTS stock_rate_type varchar(10),     -- rate type used to value stock on arrival
  ADD COLUMN IF NOT EXISTS stock_fx_rate   numeric(14,6),   -- the rate pulled at approval for stock
  ADD COLUMN IF NOT EXISTS stock_value_gbp numeric(18,2);   -- GBP value reported on arrival (closing stock)

COMMIT;
