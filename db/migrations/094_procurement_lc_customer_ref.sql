-- 094_procurement_lc_customer_ref.sql
-- The HSBC bank trade facility extract carries a `customer_reference` (e.g.
-- "LC92A 05.06.26 2/3") but not the DC reference, so the DC↔facility match is
-- easier keyed on the customer reference. Add customer_reference to the LC so
-- each LC carries DC reference → customer reference → LC (bank) reference, and
-- the reconciliation can match LC.customer_reference ↔ facility.customer_reference.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: ALTER TABLE finance.procurement_lc DROP COLUMN IF EXISTS customer_reference;

BEGIN;

ALTER TABLE finance.procurement_lc
  ADD COLUMN IF NOT EXISTS customer_reference varchar(160);

COMMIT;
