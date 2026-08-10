-- 091_procurement_report_basis.sql
-- A per-order FX reporting basis for procurement: SPOT (default) or HEDGED. It
-- controls only the GBP value REPORTED on the Procurement and Merchandising
-- views (order currency amount converted at the chosen rate) — it does NOT change
-- the recorded cash cost or the costing-FX stock valuation. Toggled from Manage LC.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.procurement_purchase DROP COLUMN IF EXISTS report_rate_type;

BEGIN;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS report_rate_type varchar(12) NOT NULL DEFAULT 'SPOT';

DO $$ BEGIN
  ALTER TABLE finance.procurement_purchase
    ADD CONSTRAINT procurement_report_rate_chk CHECK (report_rate_type IN ('SPOT','HEDGED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
