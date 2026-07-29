-- Migration 052 — Purchase Orders: department-head sign-off + finance close/challenge
-- Completes the P.O process. Once a request is signed off by the department head
-- (status APPROVED, approved_by/at stamped), Finance reviews it on the P.O Summary
-- + Close screen: records the invoice, then CLOSES it (→ committed spend) or
-- CHALLENGES it (with one or more reasons). The finance lifecycle is tracked
-- separately from the request lifecycle:
--   finance_status  OPEN → CHALLENGED / CLOSED
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order
--     DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS invoice_number, DROP COLUMN IF EXISTS invoice_amount,
--     DROP COLUMN IF EXISTS finance_status, DROP COLUMN IF EXISTS challenge_reasons,
--     DROP COLUMN IF EXISTS challenge_note, DROP COLUMN IF EXISTS challenged_by,
--     DROP COLUMN IF EXISTS challenged_at, DROP COLUMN IF EXISTS closed_by,
--     DROP COLUMN IF EXISTS closed_at;

BEGIN;

ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS approved_by       varchar(160);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS approved_at       timestamptz;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS invoice_number    varchar(120);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS invoice_amount    numeric(14,2);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS finance_status    varchar(20) NOT NULL DEFAULT 'OPEN';  -- OPEN / CHALLENGED / CLOSED
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS challenge_reasons text;      -- comma-joined reason codes
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS challenge_note    text;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS challenged_by     varchar(160);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS challenged_at     timestamptz;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS closed_by         varchar(160);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS closed_at         timestamptz;

CREATE INDEX IF NOT EXISTS ix_purchase_order_finance ON finance.purchase_order (department, finance_status);

COMMIT;
