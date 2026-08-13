-- Migration 098 — Purchase Orders: challenge return route
-- When Finance challenges a signed-off P.O, it now chooses where the P.O goes once
-- the submitter has edited it: straight back to Finance (re-review), or back through
-- department sign-off first. That choice is stored per challenge so the resubmit
-- action knows how to route it.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS challenge_return_route;

BEGIN;

ALTER TABLE finance.purchase_order
  ADD COLUMN IF NOT EXISTS challenge_return_route varchar(20);  -- TO_FINANCE / TO_SIGNOFF

COMMIT;
