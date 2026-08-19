-- Migration 106 — Add the C-Suite department
-- Adds C-Suite to the governed department dimension so it appears in the
-- department picker (P.O requests), Users & Roles department assignment and
-- department sign-off. Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DELETE FROM core.dim_department WHERE department_code = 'CSUITE';

BEGIN;

INSERT INTO core.dim_department (department_code, department_name) VALUES
  ('CSUITE', 'C-Suite')
ON CONFLICT (department_code) DO NOTHING;

COMMIT;
