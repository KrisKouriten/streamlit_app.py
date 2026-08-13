-- Migration 102 — Departmental Budgets: business vs project budgets
-- Some departments run an annual (business) budget; others budget by project. A
-- budget can now be typed BUSINESS or PROJECT, and a PROJECT budget links to an
-- existing Business Project (finance.business_project), so a department can carry
-- several project budgets — one per project — alongside or instead of an annual one.
--
-- Additive and idempotent. Existing budgets default to BUSINESS.
--
-- ROLLBACK:
--   ALTER TABLE finance.dept_budget
--     DROP COLUMN IF EXISTS budget_type,
--     DROP COLUMN IF EXISTS business_project_id;

BEGIN;

ALTER TABLE finance.dept_budget
  ADD COLUMN IF NOT EXISTS budget_type varchar(10) NOT NULL DEFAULT 'BUSINESS',  -- BUSINESS | PROJECT
  ADD COLUMN IF NOT EXISTS business_project_id bigint
    REFERENCES finance.business_project(business_project_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_dept_budget_project ON finance.dept_budget (business_project_id);

COMMIT;
