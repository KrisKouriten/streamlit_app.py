-- Migration 062 — Purchase Order process enhancements
-- Four changes that complete the P.O process:
--   1. App-generated, non-reusable P.O numbers (finance.po_number_seq + po_number).
--      Replaces quoting the Xero P.O number: the platform now mints the number on
--      save. A sequence never recycles a value, and a unique index guarantees a
--      number can never be reused — even if the P.O it was minted for is deleted.
--   2. Payment status — UNPAID / PART_PAID / PAID (+ paid_date), maintained by
--      Finance on P.O Summary + Close so departments can see whether a P.O has
--      been paid.
--   3. self_approved — marks a P.O that was signed off automatically because it
--      fell within the self-approval limit (audit clarity on the register).
--   4. governance.app_setting — a general-purpose key/value settings store,
--      seeded with the P.O self-approval limit (£; 0 = off / everything needs a
--      department-head sign-off).
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order
--     DROP COLUMN IF EXISTS po_number, DROP COLUMN IF EXISTS payment_status,
--     DROP COLUMN IF EXISTS paid_date, DROP COLUMN IF EXISTS self_approved;
--   DROP SEQUENCE IF EXISTS finance.po_number_seq;
--   DELETE FROM governance.app_setting WHERE setting_key = 'po_self_approve_limit';
--   -- (drop governance.app_setting only if nothing else uses it)

BEGIN;

-- 1) App-generated P.O numbers -------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS finance.po_number_seq START WITH 2001;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS po_number varchar(40);
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_order_po_number
  ON finance.purchase_order (po_number) WHERE po_number IS NOT NULL;

-- 2) Payment status ------------------------------------------------------------
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS payment_status varchar(20) NOT NULL DEFAULT 'UNPAID';  -- UNPAID / PART_PAID / PAID
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS paid_date      date;

-- 3) Self sign-off marker ------------------------------------------------------
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS self_approved boolean NOT NULL DEFAULT false;

-- 4) General-purpose governance settings --------------------------------------
CREATE TABLE IF NOT EXISTS governance.app_setting (
  setting_key   varchar(80) PRIMARY KEY,
  setting_value text,
  updated_by    varchar(160),
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO governance.app_setting (setting_key, setting_value)
VALUES ('po_self_approve_limit', '0')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
