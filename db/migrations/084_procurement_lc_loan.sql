-- 084_procurement_lc_loan.sql
-- A logged LC evolves before it settles: its details may be edited, an actual
-- payment date recorded once it is drawn ("booked against"), and the facility
-- converts from an Import Loan to a Trade Loan once the goods arrive in Miniso
-- UK's possession. Adds those fields to finance.procurement_lc. Idempotent.

BEGIN;

ALTER TABLE finance.procurement_lc
  ADD COLUMN IF NOT EXISTS dc_reference        varchar(120),                           -- documentary collection reference
  ADD COLUMN IF NOT EXISTS loan_type           varchar(12) NOT NULL DEFAULT 'IMPORT',  -- IMPORT | TRADE
  ADD COLUMN IF NOT EXISTS goods_arrived_date  date,
  ADD COLUMN IF NOT EXISTS actual_payment_date date;

DO $$ BEGIN
  ALTER TABLE finance.procurement_lc
    ADD CONSTRAINT procurement_lc_loan_type_chk CHECK (loan_type IN ('IMPORT','TRADE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
