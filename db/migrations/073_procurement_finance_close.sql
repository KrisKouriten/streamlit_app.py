-- Migration 073 — Procurement Summary + Close (mirrors P.O finance lifecycle) and
-- Merchandising reporting. Adds the Finance close lifecycle to procurement
-- purchases (approve → challenge → invoice → close, exactly like the P.O columns
-- from migration 052), and registers a Merchandising Pack in the Corporate
-- Reporting Centre plus a report-access grant for the Merchandising department.
--
-- Additive and idempotent. Safe to re-run. Requires finance.procurement_purchase
-- (migration 016) and the reporting/permission schema (migrations 045, 064).
--
-- ROLLBACK: the ALTERs are additive (leave the columns); to remove the reporting
--   rows: DELETE FROM finance.report_template_section WHERE template_id IN
--     (SELECT template_id FROM finance.report_template WHERE template_key='MERCHANDISING_PACK');
--   DELETE FROM finance.report_template WHERE template_key='MERCHANDISING_PACK';
--   DELETE FROM governance.department_report_permission WHERE template_key='MERCHANDISING_PACK';

BEGIN;

-- 1) Finance close lifecycle on procurement purchases (mirrors migration 052).
ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS finance_status    varchar(20) NOT NULL DEFAULT 'PENDING',  -- PENDING / APPROVED / CHALLENGED / CLOSED
  ADD COLUMN IF NOT EXISTS approved_by       varchar(160),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_number    varchar(120),
  ADD COLUMN IF NOT EXISTS invoice_amount    numeric(18,2),
  ADD COLUMN IF NOT EXISTS challenge_reasons text,
  ADD COLUMN IF NOT EXISTS challenge_note    text,
  ADD COLUMN IF NOT EXISTS challenged_by     varchar(160),
  ADD COLUMN IF NOT EXISTS challenged_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by         varchar(160),
  ADD COLUMN IF NOT EXISTS closed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS payment_status    varchar(12) NOT NULL DEFAULT 'UNPAID',   -- UNPAID / PART_PAID / PAID
  ADD COLUMN IF NOT EXISTS paid_date         date;

CREATE INDEX IF NOT EXISTS ix_procurement_finance ON finance.procurement_purchase (source, finance_status);

-- 2) Merchandising Pack — a Corporate Reporting Centre template (mirrors the
--    seeds in migration 045). Sections bind to existing source adapters plus the
--    new `procurement` adapter.
INSERT INTO finance.report_template (template_key, name, purpose, audience, frequency, default_confidentiality, default_ai, effective_date, created_by)
VALUES
  ('MERCHANDISING_PACK', 'Merchandising Pack',
   'The merchandising position for review and sign-off: Open-to-Buy by channel, procurement spend and its close status (committed / open / under challenge), the Merchandising department budget, and the open merchandising actions.',
   'Merchandising, Commercial, Finance Director, SLT.', 'Monthly or on OTB review', 'CONFIDENTIAL',
   '["COMMERCIAL_FINANCE","FINANCE_DIRECTOR","RISK"]'::jsonb, CURRENT_DATE, 'migration 073')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO finance.report_template_section (template_id, section_key, title, position, mandatory, default_source_key, default_ai_perspective, default_page_type)
SELECT t.template_id, s.section_key, s.title, s.position, s.mandatory, s.src, s.persp, s.ptype
FROM finance.report_template t
CROSS JOIN (VALUES
  ('cover',       'Cover Page',                 1, true,  NULL,          NULL,                'cover'),
  ('otb',         'Open-to-Buy Position',       2, true,  'otb',         'COMMERCIAL_FINANCE','exec_summary'),
  ('procurement', 'Procurement Spend & Close',  3, true,  'procurement', 'FINANCE_DIRECTOR',  'content'),
  ('budget',      'Merchandising Budget',       4, true,  'dept_budget', 'FPA',               'content'),
  ('actions',     'Merchandising Actions',      5, false, 'actions',     'RISK',              'content')
) AS s(section_key, title, position, mandatory, src, persp, ptype)
WHERE t.template_key = 'MERCHANDISING_PACK'
ON CONFLICT (template_id, section_key) DO NOTHING;

-- 3) Report-access grant so the Merchandising department can reach the pack in the
--    Reporting Centre (ADMIN/FINANCE/EXEC already have full access).
INSERT INTO governance.department_report_permission
  (department, template_key, can_view, can_create, can_edit, can_contribute, can_review, can_export, active, updated_by)
VALUES
  ('Merchandising', 'MERCHANDISING_PACK', true, true, true, true, true, true, true, 'migration 073')
ON CONFLICT (department, template_key) DO NOTHING;

COMMIT;
