-- Migration 012 — Management accounts close (Phase 10)
-- The month-end reconciliation playbook from "Management Accounts — Month-End
-- Workings & Process": a per-period close-action checklist (the assurance steps,
-- distinct from WORKFLOW's per-entity execution ticks), a reference model of
-- nominal expectations (fixed schedule / variable rates / tolerances) for the
-- pre-close checks, and a review log for the confirm · correct · explain cycle.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.preclose_review;
--   DROP TABLE IF EXISTS finance.ma_close_action_state;
--   DROP TABLE IF EXISTS finance.ma_close_action;
--   DROP TABLE IF EXISTS finance.nominal_expectation;

BEGIN;

-- 1. Reference model: what each nominal is expected to do.
--    behaviour: REVENUE (driver), VARIABLE (pct_of_revenue), FIXED (monthly_amount, magnitude).
--    Replaced wholesale when finance uploads the maintained schedule (source = 'SCHEDULE').
CREATE TABLE IF NOT EXISTS finance.nominal_expectation (
  expectation_id       bigserial PRIMARY KEY,
  account_code         varchar(20) NOT NULL,
  behaviour            varchar(10) NOT NULL CHECK (behaviour IN ('REVENUE','VARIABLE','FIXED')),
  monthly_amount       numeric(20,2),          -- expected magnitude per month (FIXED)
  pct_of_revenue       numeric(9,6),           -- expected rate (VARIABLE)
  tolerance_pct        numeric(9,4) NOT NULL DEFAULT 0.10,
  tolerance_abs        numeric(20,2) NOT NULL DEFAULT 1000,
  expected_every_period boolean NOT NULL DEFAULT true,
  source               varchar(60) NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nominal_expectation_active
  ON finance.nominal_expectation (account_code) WHERE is_active;

-- 2. The close-action playbook (assurance steps, per workstream) + per-period state.
CREATE TABLE IF NOT EXISTS finance.ma_close_action (
  action_id   bigserial PRIMARY KEY,
  workstream  varchar(12) NOT NULL CHECK (workstream IN ('PL','ACCRUALS','FA')),
  label       varchar(120) NOT NULL UNIQUE,
  sort        integer NOT NULL
);

CREATE TABLE IF NOT EXISTS finance.ma_close_action_state (
  action_id  bigint NOT NULL REFERENCES finance.ma_close_action(action_id),
  period     varchar(7) NOT NULL,   -- 'YYYY-MM'
  done       boolean NOT NULL DEFAULT false,
  done_by    varchar(120),
  done_at    timestamptz,
  PRIMARY KEY (action_id, period)
);

-- 3. Exception review log: confirm · correct · explain, evidenced and dated.
CREATE TABLE IF NOT EXISTS finance.preclose_review (
  review_id    bigserial PRIMARY KEY,
  period       varchar(7) NOT NULL,
  account_code varchar(20) NOT NULL,
  check_code   varchar(12) NOT NULL,   -- A (completeness) / B (variable) / C (fixed) / SIGN
  status       varchar(12) NOT NULL CHECK (status IN ('CONFIRMED','EXPLAINED','CORRECTING')),
  note         text,
  actor        varchar(120) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period, account_code, check_code)
);

-- 4. Seed the playbook actions (master checklist, workstreams 01–03; inventory is
--    WIP per the process doc). Wording is the assurance step, so nothing duplicates
--    the WORKFLOW per-entity execution ticks ("Accruals posted", "Depreciation run").
INSERT INTO finance.ma_close_action (workstream, label, sort) VALUES
  ('PL', 'Download actuals (all entities)', 1),
  ('PL', 'Load the reference model', 2),
  ('PL', 'Run completeness check — missed nominals', 3),
  ('PL', 'Run variable-drift check — vs drivers', 4),
  ('PL', 'Run fixed-drift check — vs schedule', 5),
  ('PL', 'Clear exceptions & sign off', 6),
  ('ACCRUALS', 'Reverse last month''s accruals — start clean', 1),
  ('ACCRUALS', 'Populate the monthly accrual & prepayment register', 2),
  ('ACCRUALS', 'Tie register totals to the balance sheet (per entity)', 3),
  ('ACCRUALS', 'Match arrived invoices & record accrual-vs-actual variance', 4),
  ('ACCRUALS', 'Update the invoice-receipt tracker', 5),
  ('ACCRUALS', 'Release / roll and consolidate the check-sheet', 6),
  ('FA', 'Download the fixed-asset register (all entities)', 1),
  ('FA', 'Recompute the straight-line charge, asset by asset', 2),
  ('FA', 'Match the recomputed charge to P&L depreciation', 3),
  ('FA', 'Confirm closing NBV roll-forward', 4),
  ('FA', 'Project the run-rate to zero (full life)', 5),
  ('FA', 'Flag stranded balances — past-life NBV', 6)
ON CONFLICT (label) DO NOTHING;

-- 5. Baseline expectations from the loaded Xero actuals, where present: fixed lines
--    at the H1 monthly run-rate (cumulative load ÷ 6), variable lines as a % of
--    revenue. Clearly labelled BASELINE — finance's uploaded schedule replaces it.
--    Seeds nothing if no Xero actuals are loaded, and never overwrites an active set.
INSERT INTO finance.nominal_expectation
  (account_code, behaviour, monthly_amount, pct_of_revenue, tolerance_pct, tolerance_abs, expected_every_period, source)
SELECT a.account_code,
       CASE WHEN a.account_code = '4000' THEN 'REVENUE'
            WHEN a.account_code IN ('5000','6000') THEN 'VARIABLE'
            ELSE 'FIXED' END,
       CASE WHEN a.account_code IN ('4000','5000','6000') THEN NULL
            ELSE ROUND(ABS(SUM(f.amount_gbp)) / 6.0, 2) END,
       CASE WHEN a.account_code IN ('5000','6000')
            THEN ROUND(ABS(SUM(f.amount_gbp)) / NULLIF((
                   SELECT SUM(f2.amount_gbp) FROM finance.fact_financials f2
                   JOIN core.dim_account a2 ON a2.account_id = f2.account_id
                   WHERE f2.source_system = 'XERO' AND a2.account_code = '4000'
                     AND f2.date_key = (SELECT MAX(date_key) FROM finance.fact_financials WHERE source_system='XERO')
                 ), 0), 6)
            ELSE NULL END,
       0.10, 1000, true, 'BASELINE · Cambridge H1 2026 run-rate'
FROM finance.fact_financials f
JOIN core.dim_account a ON a.account_id = f.account_id
WHERE f.source_system = 'XERO'
  AND f.date_key = (SELECT MAX(date_key) FROM finance.fact_financials WHERE source_system = 'XERO')
  AND NOT EXISTS (SELECT 1 FROM finance.nominal_expectation WHERE is_active)
GROUP BY a.account_code;

COMMIT;
