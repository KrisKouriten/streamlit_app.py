-- Migration 109 — Actual due date per invoice
-- Each invoice logged against a P.O gets its own editable due date (the actual
-- date the invoice falls due), set/changed by Finance in the Invoices panel on
-- P.O Summary + Close. A representative due date is rolled up onto the P.O
-- (finance.purchase_order.invoice_due_date — the earliest invoice due date) so
-- the "Invoice due" column and the export show the actual date once entered,
-- falling back to the P.O's planned due date (payment_date) until then.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order_invoice DROP COLUMN IF EXISTS due_date;
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS invoice_due_date;

BEGIN;

ALTER TABLE finance.purchase_order_invoice
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE finance.purchase_order
  ADD COLUMN IF NOT EXISTS invoice_due_date date;

COMMIT;
