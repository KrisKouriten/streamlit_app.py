-- Migration 118 — Travel, Expenses & Entertainment budgets per employee
-- A department head may set their T&E budget per reportee instead of for the
-- department as a whole. Each row is one employee's budget on one of the 15 T&E
-- lines, by month. The department budget's own lines (finance.dept_budget_line)
-- stay the approved figures and are always the sum of these rows, so the
-- approval workflow, dashboards and reports read the department budget as
-- before; these rows add the split beneath it.
--
-- "Unallocated" holds anything in an employee-level upload not given to a
-- named employee, so the split always adds up to the department budget.
--
-- The app also creates this table itself on the first employee-level upload
-- (lib/tee-employee.js, same statements), so it works whichever database
-- branch this file is run against.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.tee_budget_employee;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.tee_budget_employee (
  budget_id   bigint NOT NULL REFERENCES finance.dept_budget(budget_id) ON DELETE CASCADE,
  employee    varchar(160) NOT NULL,
  line_label  varchar(120) NOT NULL,
  m01 numeric(14,2) NOT NULL DEFAULT 0, m02 numeric(14,2) NOT NULL DEFAULT 0, m03 numeric(14,2) NOT NULL DEFAULT 0,
  m04 numeric(14,2) NOT NULL DEFAULT 0, m05 numeric(14,2) NOT NULL DEFAULT 0, m06 numeric(14,2) NOT NULL DEFAULT 0,
  m07 numeric(14,2) NOT NULL DEFAULT 0, m08 numeric(14,2) NOT NULL DEFAULT 0, m09 numeric(14,2) NOT NULL DEFAULT 0,
  m10 numeric(14,2) NOT NULL DEFAULT 0, m11 numeric(14,2) NOT NULL DEFAULT 0, m12 numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (budget_id, employee, line_label)
);

COMMIT;
