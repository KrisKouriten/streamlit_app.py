-- 115_procurement_trade_pay_ref.sql
-- The trade-pay drawing a paid purchase settled on.
--
-- Migration 113 records HOW a purchase was paid — Cash or TRADE_PAY. It does not
-- record WHICH drawing, so a purchase tagged trade pay could not be tied to the
-- HSBC facility, and the two registers had to be reconciled by eye.
--
-- The reference is the bank's own drawing reference, which on TradePay starts
-- WC (e.g. WCTUKA096701) and on a post-shipment buyer loan LAIUK. Stored as
-- entered and matched loosely against finance.bank_trade_facility.reference, the
-- same way LC references already are — a reference that is not on the register
-- is FLAGGED, never refused, because the extract is uploaded periodically and a
-- genuine reference may simply not be loaded yet. Refusing it would stop Finance
-- recording a payment that really happened.
--
-- The point of the link: a procurement order can be closed once the trade-pay
-- loan behind it has been settled in full.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: ALTER TABLE finance.procurement_purchase DROP COLUMN trade_pay_ref;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS trade_pay_ref varchar(40);

-- Looked up whenever the close desk reconciles a paid row against the facility.
CREATE INDEX IF NOT EXISTS ix_procurement_trade_pay_ref
  ON finance.procurement_purchase (trade_pay_ref)
  WHERE trade_pay_ref IS NOT NULL;
