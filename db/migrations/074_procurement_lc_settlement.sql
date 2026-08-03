-- Migration 074 — Letter-of-Credit settlement on procurement purchases.
-- Miniso HQ inventory is settled by HSBC Letters of Credit rather than a plain
-- supplier invoice: Finance logs the LC details + expected payment date once the
-- LC is confirmed, then reconciles the payment once the LC settles. Local Purchase
-- keeps the standard invoice → payment → close flow. Adds the LC columns to
-- finance.procurement_purchase (the same table the Procurement Summary + Close
-- desk drives).
--
-- Additive and idempotent. Safe to re-run. Requires migration 073.
--
-- ROLLBACK: the columns are additive; drop them individually if reverting.

BEGIN;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS lc_reference      varchar(120),
  ADD COLUMN IF NOT EXISTS lc_amount         numeric(18,2),
  ADD COLUMN IF NOT EXISTS lc_bank           varchar(80),
  ADD COLUMN IF NOT EXISTS lc_confirmed_date date,          -- date the LC was confirmed
  ADD COLUMN IF NOT EXISTS lc_payment_date   date,          -- expected settlement / payment date
  ADD COLUMN IF NOT EXISTS lc_settled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lc_settled_date   date,          -- date the LC actually settled
  ADD COLUMN IF NOT EXISTS lc_settled_amount numeric(18,2);

COMMIT;
