-- Migration 122 — Business Projects: planned start and target finish dates
-- A project now carries two dates:
--   start_date   planned start
--   target_date  target finish (the old month-only "Target" becomes a date)
-- target_ym stays, set from the target finish date, because the projects
-- dashboard's delivery timeline groups by month.
--
-- Each statement is also offered by the app's own repair (lib/migration-repairs.js)
-- and run on first use, so it works whichever database branch this file reaches.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.business_project DROP COLUMN IF EXISTS start_date;
--   ALTER TABLE finance.business_project DROP COLUMN IF EXISTS target_date;

BEGIN;

ALTER TABLE finance.business_project ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE finance.business_project ADD COLUMN IF NOT EXISTS target_date date;

COMMIT;
