-- ============================================================================
-- Migration 008 — Intercompany transactions register
--
-- One table for the three intercompany ledgers (Bank Cash, Inventory & Recharges,
-- Disbursements). Common columns cover all three; category-specific fields are
-- nullable. Reconciliation is a small common set of flags mapped from each
-- ledger's own columns. Entities are referenced by dim_entity (credit = CF out,
-- debit = CF in). Rows arrive by CSV upload or manual entry (source column).
--
-- Idempotent: safe to re-run.
--
-- ROLLBACK: DROP TABLE IF EXISTS finance.intercompany_txn;
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS finance.intercompany_txn (
  txn_id            bigserial PRIMARY KEY,
  category          varchar(24)  NOT NULL,            -- CASH | INVENTORY_RECHARGES | DISBURSEMENTS
  txn_date          date         NOT NULL,
  credit_entity_id  bigint       REFERENCES core.dim_entity(entity_id),   -- CF out
  debit_entity_id   bigint       REFERENCES core.dim_entity(entity_id),   -- CF in
  currency          varchar(3)   NOT NULL DEFAULT 'GBP',
  gross_amount      numeric(16,2),
  net_amount        numeric(16,2),
  vat_amount        numeric(16,2),
  reference         varchar(120),
  invoice_number    varchar(120),
  supplier_name     varchar(160),
  nominal           varchar(80),
  payment_method    varchar(40),
  -- reconciliation flags (superset across the three ledgers; unused ones stay false)
  recon_credit          boolean NOT NULL DEFAULT false,   -- credit-side account/bank reconciled
  recon_debit           boolean NOT NULL DEFAULT false,   -- debit-side account/bank reconciled
  recon_balance_sheet   boolean NOT NULL DEFAULT false,   -- JOIIN/Xero balance sheet reconciled
  recon_cashflow        boolean NOT NULL DEFAULT false,   -- cashflow reconciled (cash ledger)
  settled               boolean NOT NULL DEFAULT false,   -- settled on Xero (disbursements)
  source            varchar(12)  NOT NULL DEFAULT 'MANUAL',  -- CSV | MANUAL
  created_by        varchar(160),
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ic_txn_cat_date ON finance.intercompany_txn (category, txn_date DESC);

COMMIT;
