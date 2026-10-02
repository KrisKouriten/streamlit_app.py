-- Migration 120 — the supplier payment date on a procurement order
-- Every order now shows two payment dates:
--   supplier payment date   when the supplier is due to be paid. Defaults to the
--                           invoice date (order month-end) plus the supplier's
--                           terms; this column holds the date Merch set instead,
--                           so the team can see dates against the supplier's terms.
--   Miniso UK payment date  180 days on the invoice / pickup date. It drives the
--                           cash budget and is never stored or edited — it is
--                           worked out from the order's own dates.
--
-- Also offered by the app's own repair (lib/migration-repairs.js) and run on
-- first use, so it works whichever database branch this file reaches.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.procurement_purchase DROP COLUMN IF EXISTS supplier_pay_date;

BEGIN;

ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS supplier_pay_date date;

COMMIT;
