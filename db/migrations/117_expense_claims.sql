-- Migration 117 — Expense claims
-- The expense-claims export from Xero (one row per claim line), loaded so each
-- department can track its claimed spend against its Travel, Expenses &
-- Entertainment budget (dept_budget.budget_type = 'TEE').
--
-- An upload replaces every line dated inside the file's own date range, so the
-- same year-to-date export can be loaded again each month without doubling up.
-- The department is kept exactly as the export names it; mapping it onto the
-- app's department list happens when the lines are read, so a mapping changed
-- later applies to every line already loaded.
--
-- Amounts are GBP. net_amount is the line before VAT (the export's LineAmount),
-- which is the basis departmental budgets are set on; VAT is kept alongside.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.expense_claim_line;
--   DROP TABLE IF EXISTS finance.expense_claim_upload;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.expense_claim_upload (
  upload_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename     varchar(240),
  line_count   integer NOT NULL DEFAULT 0,
  date_from    date,
  date_to      date,
  net_total    numeric(14,2),
  replaced     integer NOT NULL DEFAULT 0,       -- lines in that range the upload replaced
  uploaded_by  varchar(160),
  uploaded_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance.expense_claim_line (
  line_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id           bigint REFERENCES finance.expense_claim_upload(upload_id) ON DELETE CASCADE,
  claimant            varchar(160) NOT NULL,
  department          varchar(120),              -- as named in the export
  claim_date          date NOT NULL,
  due_date            date,
  description         varchar(400),
  quantity            numeric(14,4),
  unit_amount         numeric(14,4),
  net_amount          numeric(14,2) NOT NULL,    -- before VAT
  tax_amount          numeric(14,2) NOT NULL DEFAULT 0,
  account_code        varchar(20),
  tax_type            varchar(60),
  store_tracking      varchar(120),              -- Xero tracking "Store"
  allocation_tracking varchar(120),              -- Xero tracking "Allocation"
  status              varchar(30)
);

CREATE INDEX IF NOT EXISTS ix_expense_claim_line_date ON finance.expense_claim_line (claim_date);
CREATE INDEX IF NOT EXISTS ix_expense_claim_line_dept ON finance.expense_claim_line (department);

COMMIT;
