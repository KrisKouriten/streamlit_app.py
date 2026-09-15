-- Migration 112 — Card / pre-approved spend
-- A log of spend already made on a company card, or otherwise pre-approved, that
-- does NOT go through the Purchase Order + sign-off flow (supplier, amount,
-- description, department, budget link, date). It still reports as committed
-- spend against the assigned Departmental Budget so budget holders see the true
-- position — no P.O number, no sign-off, no invoice/payment tracking.
--
-- Mirrors finance.misc_spend (migration 103) but keyed on a supplier rather than
-- a fixed category, and GBP-only. The owning department is derived from the
-- assigned budget.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.card_spend;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.card_spend (
  card_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  spend_date   date,
  supplier     varchar(160) NOT NULL,       -- who it was paid to
  description  varchar(240),
  amount       numeric(14,2) NOT NULL,      -- GBP
  department   varchar(120),                -- derived from the assigned budget
  budget_id    bigint REFERENCES finance.dept_budget(budget_id) ON DELETE SET NULL,
  notes        text,
  created_by   varchar(160),
  created_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   varchar(160),
  updated_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_card_spend_budget ON finance.card_spend (budget_id);
CREATE INDEX IF NOT EXISTS ix_card_spend_dept   ON finance.card_spend (department);

COMMIT;
