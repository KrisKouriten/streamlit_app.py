-- Migration 076 — pickup date + delivery month on procurement purchases.
-- Miniso HQ inventory is bought on fixed 180-day terms calculated from the goods
-- PICKUP date (ex-works Guangzhou), not the order month; every purchase also records
-- the expected DELIVERY month. Local Purchase keeps manually-entered terms and the
-- order-month cash-out basis. Adds the two columns the Procurement Requests desk
-- writes; the cash-out maths lives in procurement-rules.js.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: the columns are additive; drop them individually if reverting.

BEGIN;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS pickup_date  date,          -- Miniso HQ: goods pickup / ex-works date (drives 180-day terms)
  ADD COLUMN IF NOT EXISTS delivery_ym  char(7);       -- expected delivery month 'YYYY-MM'

COMMIT;
