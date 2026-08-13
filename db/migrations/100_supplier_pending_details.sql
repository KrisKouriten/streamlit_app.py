-- Migration 100 — Suppliers: quick-add "awaiting Finance details" flag
-- People raising a Procurement Request or a Purchase Order can now add a supplier
-- inline when it isn't yet on the master. That creates a stub supplier (name only)
-- so it appears in the dropdown immediately; Finance then completes its credit
-- limit, payment terms and source classification on Suppliers & Credit. This flag
-- marks such stubs so Finance can see which suppliers still need their details.
-- It clears automatically the first time Finance saves the supplier.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.supplier DROP COLUMN IF EXISTS pending_details;

BEGIN;

ALTER TABLE finance.supplier
  ADD COLUMN IF NOT EXISTS pending_details boolean NOT NULL DEFAULT false;

COMMIT;
