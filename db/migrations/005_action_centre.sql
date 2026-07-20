-- Migration 005 — Action Centre & Benefits tracker (Phase 4)
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS intelligence.benefit_validation, intelligence.benefit_measurement,
--                        intelligence.benefit_opportunity CASCADE;
--   DROP TABLE IF EXISTS intelligence.action_update, intelligence.action_evidence CASCADE;
--   ALTER TABLE intelligence.action_register
--     DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS source_ref, DROP COLUMN IF EXISTS sponsor,
--     DROP COLUMN IF EXISTS root_cause, DROP COLUMN IF EXISTS progress_pct, DROP COLUMN IF EXISTS dashboard_code,
--     DROP COLUMN IF EXISTS kpi_id, DROP COLUMN IF EXISTS agent_run_id,
--     DROP COLUMN IF EXISTS closure_approved_by, DROP COLUMN IF EXISTS closure_approved_at;
--   (the CLOSED status value cannot be un-added without rewriting the CHECK; harmless to leave)

-- 1. Extend the existing action register (one common table — extend, don't duplicate)
ALTER TABLE intelligence.action_register
  ADD COLUMN IF NOT EXISTS source_type         varchar(24),
  ADD COLUMN IF NOT EXISTS source_ref          varchar(200),
  ADD COLUMN IF NOT EXISTS sponsor             varchar(120),
  ADD COLUMN IF NOT EXISTS root_cause          text,
  ADD COLUMN IF NOT EXISTS progress_pct        smallint CHECK (progress_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS dashboard_code      varchar(60) REFERENCES intelligence.dashboard_registry(dashboard_code),
  ADD COLUMN IF NOT EXISTS kpi_id              bigint REFERENCES intelligence.dim_kpi(kpi_id),
  ADD COLUMN IF NOT EXISTS agent_run_id        bigint REFERENCES agent.agent_run(run_id),
  ADD COLUMN IF NOT EXISTS closure_approved_by varchar(120),
  ADD COLUMN IF NOT EXISTS closure_approved_at timestamptz;

-- Add CLOSED (closure-approved) as a distinct terminal state, separate from
-- COMPLETE (owner has finished the work).
ALTER TABLE intelligence.action_register DROP CONSTRAINT IF EXISTS action_register_status_check;
ALTER TABLE intelligence.action_register
  ADD CONSTRAINT action_register_status_check
  CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETE','CLOSED','CANCELLED','OVERDUE'));

-- Source taxonomy is enforced in the app; a soft check documents the allowed set.
ALTER TABLE intelligence.action_register DROP CONSTRAINT IF EXISTS action_register_source_check;
ALTER TABLE intelligence.action_register
  ADD CONSTRAINT action_register_source_check
  CHECK (source_type IS NULL OR source_type IN
    ('DASHBOARD','MONTH_END','WEEKLY_TASK','AI_AGENT','MANAGEMENT_ACCOUNTS','BOARD','CONTROL','AUDIT','MANUAL'));

CREATE INDEX IF NOT EXISTS idx_action_status ON intelligence.action_register(status);
CREATE INDEX IF NOT EXISTS idx_action_source ON intelligence.action_register(source_type);

-- Backfill provenance for actions created before this phase.
UPDATE intelligence.action_register a
SET source_type = CASE WHEN a.agent_run_id IS NOT NULL OR i.agent_run_id IS NOT NULL THEN 'AI_AGENT'
                       WHEN a.insight_id IS NOT NULL THEN 'AI_AGENT' ELSE 'MANUAL' END
FROM intelligence.ai_insight i
WHERE a.insight_id = i.insight_id AND a.source_type IS NULL;
UPDATE intelligence.action_register SET source_type = 'MANUAL' WHERE source_type IS NULL;
-- Link agent-originated actions to their run where we can infer it.
UPDATE intelligence.action_register a
SET agent_run_id = i.agent_run_id
FROM intelligence.ai_insight i
WHERE a.insight_id = i.insight_id AND a.agent_run_id IS NULL AND i.agent_run_id IS NOT NULL;

-- 2. Evidence and an update/progress log for actions
CREATE TABLE IF NOT EXISTS intelligence.action_evidence (
    evidence_id     bigserial PRIMARY KEY,
    action_id       bigint NOT NULL REFERENCES intelligence.action_register(action_id),
    label           varchar(200) NOT NULL,
    url             varchar(600),
    note            text,
    added_by        varchar(160) NOT NULL,
    added_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intelligence.action_update (
    update_id       bigserial PRIMARY KEY,
    action_id       bigint NOT NULL REFERENCES intelligence.action_register(action_id),
    author          varchar(160) NOT NULL,
    body            text,
    from_status     varchar(20),
    to_status       varchar(20),
    progress_pct    smallint,
    created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_action_update_action ON intelligence.action_update(action_id);

-- 3. Benefits: opportunity -> measurement -> validation
CREATE TABLE IF NOT EXISTS intelligence.benefit_opportunity (
    opportunity_id      bigserial PRIMARY KEY,
    title               varchar(250) NOT NULL,
    description         text,
    category            varchar(60),
    source_type         varchar(24) NOT NULL DEFAULT 'MANUAL',
    expected_value_gbp  numeric(20,2),
    owner_name          varchar(120),
    action_id           bigint REFERENCES intelligence.action_register(action_id),
    insight_id          bigint REFERENCES intelligence.ai_insight(insight_id),
    status              varchar(16) NOT NULL DEFAULT 'PROPOSED'
                        CHECK (status IN ('PROPOSED','IN_DELIVERY','REALISED','VALIDATED','REJECTED')),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_benefit_opp_source ON intelligence.benefit_opportunity(source_type);

CREATE TABLE IF NOT EXISTS intelligence.benefit_measurement (
    measurement_id      bigserial PRIMARY KEY,
    opportunity_id      bigint NOT NULL REFERENCES intelligence.benefit_opportunity(opportunity_id),
    period_end          date,
    measured_value_gbp  numeric(20,2) NOT NULL,
    note                text,
    measured_by         varchar(160) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intelligence.benefit_validation (
    validation_id       bigserial PRIMARY KEY,
    opportunity_id      bigint NOT NULL REFERENCES intelligence.benefit_opportunity(opportunity_id),
    validated_value_gbp numeric(20,2) NOT NULL,
    decision            varchar(12) NOT NULL CHECK (decision IN ('VALIDATED','DISPUTED')),
    validated_by        varchar(160) NOT NULL,
    comment             text,
    validated_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill benefit opportunities for existing value-bearing actions so the
-- tracker has content from day one.
INSERT INTO intelligence.benefit_opportunity (title, source_type, expected_value_gbp, owner_name, action_id, insight_id, status)
SELECT a.action_title, COALESCE(a.source_type, 'MANUAL'), a.expected_value_gbp, a.owner_name, a.action_id, a.insight_id,
       CASE WHEN a.status IN ('CLOSED','COMPLETE') THEN 'REALISED' ELSE 'IN_DELIVERY' END
FROM intelligence.action_register a
WHERE a.expected_value_gbp IS NOT NULL AND a.expected_value_gbp <> 0
  AND NOT EXISTS (SELECT 1 FROM intelligence.benefit_opportunity o WHERE o.action_id = a.action_id);
