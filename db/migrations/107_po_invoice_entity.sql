-- Migration 107 — Purchase order: entity to be invoiced
-- Records which legal entity a P.O will be invoiced to. Chosen by the requester
-- on Purchase Order Requests (a required dropdown) and surfaced to Finance on
-- P.O Summary + Close and in the Excel export.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS invoice_entity_id;

BEGIN;

ALTER TABLE finance.purchase_order
  ADD COLUMN IF NOT EXISTS invoice_entity_id bigint REFERENCES core.dim_entity(entity_id);

CREATE INDEX IF NOT EXISTS ix_purchase_order_invoice_entity
  ON finance.purchase_order (invoice_entity_id);

COMMIT;
