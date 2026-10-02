-- Migration 119 — VAT recorded alongside net invoices and spend
-- Budgets are set ex-VAT, so everything compared with them stays NET. These
-- columns record the VAT beside the net, exactly as on the invoice or receipt,
-- so the gross (what leaves the bank) can be shown without ever being added to
-- a budget figure:
--   purchase_order_invoice.vat_amount   the VAT on each supplier invoice on a P.O
--   procurement_purchase.invoice_vat    the VAT on a procurement order's invoice
--   card_spend.vat_amount               the VAT on a card / pre-approved purchase
--   misc_spend.vat_amount               the VAT on a miscellaneous spend item
-- invoice_amount / amount keep meaning NET. A null VAT means "not recorded".
--
-- Each statement is also offered by the app's own repair (lib/migration-repairs.js)
-- and run on first use, so it works whichever database branch this file reaches.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order_invoice DROP COLUMN IF EXISTS vat_amount;
--   ALTER TABLE finance.procurement_purchase DROP COLUMN IF EXISTS invoice_vat;
--   ALTER TABLE finance.card_spend DROP COLUMN IF EXISTS vat_amount;
--   ALTER TABLE finance.misc_spend DROP COLUMN IF EXISTS vat_amount;

BEGIN;

ALTER TABLE finance.purchase_order_invoice ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS invoice_vat numeric(14,2);
ALTER TABLE finance.card_spend ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2);
ALTER TABLE finance.misc_spend ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2);

COMMIT;
