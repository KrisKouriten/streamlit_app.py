-- 114_procurement_dc_expected.sql
-- Give a Documentary Credit an expected payment month.
--
-- A Miniso request's cash-out month is currently estimated as pickup + 180 days.
-- That is a good estimate before anything is drawn, but once the DCs and LCs
-- exist the bank's own dates are better — and they differ: an LC whose request
-- estimates February has been seen expecting settlement in March.
--
-- An LC already carries lc_payment_date (074) and, once drawn, appears on the
-- trade facility with a real due date. What has had nowhere to live is the part
-- of a DC that has NOT yet been drawn as an LC:
--
--   open balance = dc_value − Σ (its LCs' lc_amount)
--
-- That balance is a firm commitment with no LC and therefore no date of its own.
-- This column is where Finance record when they expect it to be paid, so the
-- open balance lands in a month rather than nowhere.
--
-- Nullable: a DC whose expected month is not yet known falls back to the
-- request's pickup + 180 estimate, which is what happens today.
--
-- Additive and idempotent. No transaction wrapper — the Neon SQL editor runs
-- its own, and a BEGIN/COMMIT pair here has silently rolled a migration back
-- before now.
--
-- ROLLBACK: ALTER TABLE finance.procurement_dc DROP COLUMN IF EXISTS expected_payment_date;

ALTER TABLE finance.procurement_dc
  ADD COLUMN IF NOT EXISTS expected_payment_date date;

COMMENT ON COLUMN finance.procurement_dc.expected_payment_date IS
  'When the undrawn balance of this DC (dc_value - logged LCs) is expected to be paid. Places that open commitment in a month; falls back to the request pickup + 180 days when null.';
