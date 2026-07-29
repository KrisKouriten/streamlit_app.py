-- Migration 054 — Intercompany: link a transaction back to its source P.O
-- When a recharge-enabled purchase order is closed, its recharge allocation is
-- auto-posted as draft rows on the Inventory & Recharges ledger (one per store).
-- po_id records which P.O a row came from, so the auto-post can be idempotent
-- (never duplicate on a re-close) and traceable back to the P.O.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS finance.ix_intercompany_txn_po;
--   ALTER TABLE finance.intercompany_txn DROP COLUMN IF EXISTS po_id;

BEGIN;

ALTER TABLE finance.intercompany_txn ADD COLUMN IF NOT EXISTS po_id bigint;
CREATE INDEX IF NOT EXISTS ix_intercompany_txn_po ON finance.intercompany_txn (po_id);

COMMIT;
