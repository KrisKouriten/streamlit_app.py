-- Migration 113 — Procurement invoice payment method (Cash / Trade pay)
-- When Finance marks a procurement purchase as paid they now record HOW it was
-- settled: CASH, or TRADE_PAY (drawn on the HSBC trade facility).
--
-- This drives the split of "spent" on the Procurement Requests page:
--   * trade-pay spend is reported from the bank trade facility upload
--     (finance.bank_trade_facility), which is the source of truth for it;
--   * cash spend is reported from the cash-paid purchases, on top of the facility.
-- Tagging a purchase TRADE_PAY therefore marks it as already covered by the
-- facility upload, so it is not double-counted as cash.
--
-- NULL means not paid yet, or paid before the method was captured.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.procurement_purchase DROP COLUMN IF EXISTS payment_method;

BEGIN;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS payment_method varchar(12);

COMMIT;
