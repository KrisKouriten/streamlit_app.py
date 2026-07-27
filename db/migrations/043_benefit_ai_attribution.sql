-- Migration 043 — Finance Intelligence Layer, Phase 5b (benefit measurement)
-- Closes the loop on the intelligence layer: lets an AI recommendation become a
-- tracked benefit opportunity attributed to the run that raised it, so expected
-- vs realised vs validated £ can be measured for AI-recommended work.
--
-- Reuses the existing Phase-4 benefit tables (opportunity → measurement →
-- validation). Only adds attribution columns; the expected value is still set by
-- a human, keeping governance clean (the model never invents a £ figure).
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE intelligence.benefit_opportunity
--     DROP COLUMN IF EXISTS ai_run_id, DROP COLUMN IF EXISTS origin_surface;

BEGIN;

ALTER TABLE intelligence.benefit_opportunity
  ADD COLUMN IF NOT EXISTS ai_run_id      bigint REFERENCES intelligence.ai_run(run_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_surface varchar(16);   -- BRIEFING | PERSPECTIVE | BUDDY | COMMENTARY

-- The realisation view filters AI-originated opportunities.
CREATE INDEX IF NOT EXISTS ix_benefit_ai_run ON intelligence.benefit_opportunity (ai_run_id);

COMMIT;
