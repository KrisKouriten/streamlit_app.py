-- Migration 064 — Corporate report access by department
-- Controls which Corporate Reporting Centre reports each department may access.
-- A relationship table (department × report template × verb matrix) rather than
-- fixed boolean columns, so new reports and new verbs need no schema change. The
-- initial UI exposes CAN VIEW; the wider verbs are stored and ready.
--
-- Access model (enforced server-side):
--   ADMIN / FINANCE / EXEC keep full access (unchanged — the finance/exec team).
--   Other departments/roles may access a report only where an active grant exists.
-- This preserves current behaviour on day one (non-finance roles could not reach
-- the Reporting Centre before) and lets a department be granted specific reports.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS governance.department_report_permission;

BEGIN;

CREATE TABLE IF NOT EXISTS governance.department_report_permission (
  perm_id                        bigserial PRIMARY KEY,
  department                     varchar(120) NOT NULL,
  template_key                   varchar(60)  NOT NULL,   -- finance.report_template.template_key
  can_view                       boolean NOT NULL DEFAULT false,
  can_create                     boolean NOT NULL DEFAULT false,
  can_edit                       boolean NOT NULL DEFAULT false,
  can_contribute                 boolean NOT NULL DEFAULT false,
  can_review                     boolean NOT NULL DEFAULT false,
  can_approve                    boolean NOT NULL DEFAULT false,
  can_export                     boolean NOT NULL DEFAULT false,
  can_view_confidential_appendix boolean NOT NULL DEFAULT false,
  effective_from                 date,
  effective_to                   date,
  active                         boolean NOT NULL DEFAULT true,
  updated_by                     varchar(160),
  updated_at                     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dept_report_perm
  ON governance.department_report_permission (department, template_key);

-- Fix: the export audit records a Word export as format 'DOCX', but the original
-- report_export.format CHECK only allowed PPTX/PDF/XLSX, so a Word export would
-- fail at recordExport. Widen the constraint to include DOCX.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'finance' AND table_name = 'report_export') THEN
    ALTER TABLE finance.report_export DROP CONSTRAINT IF EXISTS report_export_format_check;
    ALTER TABLE finance.report_export ADD CONSTRAINT report_export_format_check
      CHECK (format IN ('PPTX', 'PDF', 'XLSX', 'DOCX'));
  END IF;
END $$;

COMMIT;
