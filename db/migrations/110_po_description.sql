-- Migration 110 — Purchase order description
-- A short free-text description of what the P.O is for, captured when raising it
-- and shown as a column on the Purchase Order Requests list (and P.O Summary +
-- Close) so you can see at a glance what each P.O covers.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS description;

BEGIN;

ALTER TABLE finance.purchase_order
  ADD COLUMN IF NOT EXISTS description varchar(300);

COMMIT;
