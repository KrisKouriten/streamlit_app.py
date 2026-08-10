-- 092_supplier_terms_merch.sql
-- Extend the supplier master (migration 090) with:
--   * payment_days  — the supplier's payment terms (days), used to pre-fill the
--     cash-out timing when a purchase is raised against the supplier.
--   * active_merch  — whether the supplier sits within the Merch budget. When
--     false, the supplier's purchases are excluded from the procurement reports
--     and the Merchandising dashboard (they remain on the Suppliers & Credit
--     desk and the cash tracker).
-- source_type stays a free tag but the app now writes a canonical value
-- (MINISO / LOCAL / OTHER) chosen from a dropdown.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.supplier DROP COLUMN IF EXISTS payment_days;
--   ALTER TABLE finance.supplier DROP COLUMN IF EXISTS active_merch;

BEGIN;

ALTER TABLE finance.supplier
  ADD COLUMN IF NOT EXISTS payment_days integer,
  ADD COLUMN IF NOT EXISTS active_merch boolean NOT NULL DEFAULT true;

COMMIT;
