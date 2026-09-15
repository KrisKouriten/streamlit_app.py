-- Migration 111 — Invoice processing status
-- Each invoice logged against a P.O now carries a processing-workflow status so
-- Finance can see where it is in the pipeline:
--   Received → Processing → Reviewing → Paid
-- This is the per-invoice lifecycle. It is distinct from the P.O's payment status
-- (Unpaid / Part-paid / Paid), which rolls up across all the P.O's invoices. The
-- workflow's terminal "Paid" stage stays in step with the invoice's `paid` flag,
-- so the payment rollup keeps working: setting an invoice to Paid marks it paid,
-- and any earlier stage marks it unpaid.
--
-- Backfill: invoices already paid become 'PAID'; everything else 'RECEIVED'.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order_invoice DROP COLUMN IF EXISTS invoice_status;

BEGIN;

ALTER TABLE finance.purchase_order_invoice
  ADD COLUMN IF NOT EXISTS invoice_status varchar(20) NOT NULL DEFAULT 'RECEIVED';

-- Line up existing rows: paid invoices are at the end of the workflow.
UPDATE finance.purchase_order_invoice
   SET invoice_status = 'PAID'
 WHERE paid = true
   AND invoice_status = 'RECEIVED';

COMMIT;
