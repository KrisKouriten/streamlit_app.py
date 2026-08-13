-- Migration 101 — Purchase Orders: re-derive payment status against the P.O value
-- A P.O with child invoices was being marked PAID as soon as every *entered*
-- invoice was paid, even when those invoices didn't cover the P.O value (e.g. one
-- £330 invoice paid against a £1,700 P.O). The corrected rule (in lib/po-rules.js)
-- only marks a P.O PAID once the paid invoices cover its value; otherwise it is
-- PART_PAID. This one-off re-derives payment_status / paid_date for every P.O that
-- has child invoices, so rows stored under the old rule are corrected.
--
-- Data-only, idempotent (re-running yields the same result). Safe to re-run.

BEGIN;

WITH agg AS (
  SELECT po_id,
         COALESCE(SUM(invoice_amount) FILTER (WHERE paid), 0) AS paid_sum,
         MAX(paid_date) FILTER (WHERE paid)                   AS last_paid
    FROM finance.purchase_order_invoice
   GROUP BY po_id
)
UPDATE finance.purchase_order po
   SET payment_status = CASE
         WHEN a.paid_sum <= 0.01                                    THEN 'UNPAID'
         WHEN a.paid_sum + 0.01 >= COALESCE(po.payment_value, 0)    THEN 'PAID'
         ELSE 'PART_PAID' END,
       paid_date = CASE WHEN a.paid_sum <= 0.01 THEN NULL ELSE a.last_paid END,
       updated_at = CURRENT_TIMESTAMP
  FROM agg a
 WHERE a.po_id = po.po_id;

COMMIT;
