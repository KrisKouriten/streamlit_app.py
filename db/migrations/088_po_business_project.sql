-- 088_po_business_project.sql
-- Purchase Orders can be allocated to a Business Project (Plan — HO). This is the
-- cross-link the Projects Dashboard needs to report actual project spend/burn:
-- when a department raises a P.O it can tag it to a business project, and that
-- spend then rolls up per project (and per department) against the project's
-- planned costs. Optional — a P.O without a project is unchanged.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS business_project_id;

BEGIN;

ALTER TABLE finance.purchase_order
  ADD COLUMN IF NOT EXISTS business_project_id bigint;

-- FK to the business-projects register (guarded so the migration is re-runnable).
DO $$ BEGIN
  ALTER TABLE finance.purchase_order
    ADD CONSTRAINT fk_po_business_project
    FOREIGN KEY (business_project_id) REFERENCES finance.business_project(business_project_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_po_business_project ON finance.purchase_order(business_project_id);

COMMIT;
