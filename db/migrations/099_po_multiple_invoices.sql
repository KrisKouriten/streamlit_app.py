-- Migration 099 — Purchase Orders: multiple invoices per P.O
-- A P.O can be billed by more than one supplier invoice (e.g. two invoices raised
-- against one order). This adds a child table so each invoice is captured with its
-- own number, amount and paid state; the P.O's payment status (Unpaid / Part-paid /
-- Paid) then rolls up from the invoices, and the parent invoice_amount is kept as
-- the sum for the register/close/dashboard which read it.
--
-- Existing single invoices (finance.purchase_order.invoice_number/amount) are
-- backfilled as the first invoice, marked paid when the P.O was already PAID.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.purchase_order_invoice;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.purchase_order_invoice (
  invoice_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id           bigint NOT NULL REFERENCES finance.purchase_order(po_id) ON DELETE CASCADE,
  invoice_number  varchar(120),
  invoice_amount  numeric(14,2),
  invoice_date    date,
  paid            boolean NOT NULL DEFAULT false,
  paid_date       date,
  created_by      varchar(160),
  created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_po_invoice_po ON finance.purchase_order_invoice (po_id);

-- Backfill: move any existing single invoice into the child table as invoice #1.
INSERT INTO finance.purchase_order_invoice (po_id, invoice_number, invoice_amount, paid, paid_date, created_by, created_at)
SELECT po.po_id, po.invoice_number, po.invoice_amount,
       (po.payment_status = 'PAID'),
       CASE WHEN po.payment_status = 'PAID' THEN po.paid_date ELSE NULL END,
       'backfill-099', CURRENT_TIMESTAMP
  FROM finance.purchase_order po
 WHERE (po.invoice_number IS NOT NULL OR po.invoice_amount IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM finance.purchase_order_invoice i WHERE i.po_id = po.po_id);

COMMIT;
