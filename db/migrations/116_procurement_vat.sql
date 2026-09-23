-- 116_procurement_vat.sql
-- VAT on a procurement request.
--
-- The procurement budget is a cash-out plan, and what leaves the bank is the
-- GROSS invoice: we pay the supplier VAT and reclaim it from HMRC later, on a
-- different timetable. The requests were a mix — Merch entered whatever was on
-- the quote — so a month's committed figure was part net and part gross with
-- nothing recording which.
--
-- `amount_gbp` keeps meaning NET. It is what Merch types and what every existing
-- row holds; changing its meaning in place would silently restate history rather
-- than explain it. Gross is derived: amount_gbp x (1 + vat_rate).
--
-- NULL means "not stated", and the reader defaults by source rather than
-- assuming zero:
--   LOCAL / Merchandising  20%  — UK suppliers charge VAT
--   MINISO                  0%  — import VAT is paid to HMRC at the border, not
--                                 to the supplier, so it is not part of what the
--                                 letter of credit or the facility pays
-- Storing the default instead of leaving NULL would freeze today's rate onto
-- every historic row; leaving it NULL lets the rule apply and stay visible.
--
-- A rate rather than a flag, so a change of rate — or a reduced rate on a
-- category — is data rather than a deploy. 0.2000 = 20%.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: ALTER TABLE finance.procurement_purchase DROP COLUMN vat_rate;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4);

DO $$ BEGIN
  ALTER TABLE finance.procurement_purchase
    ADD CONSTRAINT procurement_vat_rate_chk CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
