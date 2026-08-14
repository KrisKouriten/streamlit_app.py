-- Migration 103 — Miscellaneous spend
-- Small planned expenditure that doesn't warrant a Purchase Order (travel, meals,
-- office supplies, petty cash, …), logged by category and assigned to a department
-- budget (a Business annual budget or a Project budget). No approval workflow — it
-- feeds a "Miscellaneous" task total on the assigned Departmental Budget.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.misc_spend;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.misc_spend (
  misc_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spend_date   date,
  category     varchar(40) NOT NULL,      -- one of the fixed misc categories
  description  varchar(240),
  amount       numeric(14,2) NOT NULL,
  department   varchar(120),              -- derived from the assigned budget
  budget_id    bigint REFERENCES finance.dept_budget(budget_id) ON DELETE SET NULL,
  notes        text,
  created_by   varchar(160),
  created_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   varchar(160),
  updated_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_misc_spend_budget ON finance.misc_spend (budget_id);
CREATE INDEX IF NOT EXISTS ix_misc_spend_dept   ON finance.misc_spend (department);

COMMIT;
