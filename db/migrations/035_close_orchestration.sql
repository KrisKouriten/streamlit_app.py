-- Migration 035 — Close orchestration (Tier 3.1, close automation)
-- Turns the month-end close from a manual checklist into a tracked engine. A
-- period's close is a `close_run`; the machine-checkable gates (actuals loaded,
-- feeds fresh, pre-close exceptions cleared, playbook complete, tasks done,
-- commentary drafted) are evaluated automatically from existing data by
-- lib/close-plan-rules.js — nothing is stored for those. Only the human
-- dispositions are persisted: `close_step_override` (a sign-off, waiver or
-- block on a step) and the run's own lifecycle (opened → locked → reopened).
--
-- Also registers the CLOSE_STATUS agent (implementation in lib/agents.js) which
-- reports close readiness on a schedule. Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DELETE FROM agent.agent_performance WHERE agent_code='CLOSE_STATUS';
--   DELETE FROM agent.agent_version     WHERE agent_code='CLOSE_STATUS';
--   DELETE FROM agent.agent_registry    WHERE agent_code='CLOSE_STATUS';
--   DROP TABLE IF EXISTS close.close_step_override;
--   DROP TABLE IF EXISTS close.close_run;
--   DROP SCHEMA IF EXISTS close;

BEGIN;

CREATE SCHEMA IF NOT EXISTS close;

-- One close run per period (YYYY-MM). status: OPEN (in progress), LOCKED
-- (signed off and closed), REOPENED (was locked, opened again for a correction).
CREATE TABLE IF NOT EXISTS close.close_run (
  run_id      bigserial PRIMARY KEY,
  period      varchar(7) NOT NULL UNIQUE CHECK (period ~ '^\d{4}-\d{2}$'),
  status      varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED','REOPENED')),
  note        text,
  opened_by   varchar(120) NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by   varchar(120),
  locked_at   timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Human dispositions on individual steps: a manual sign-off (DONE), a waiver
-- (NA — not applicable this period) or a block (BLOCKED). AUTO steps evaluate
-- themselves; an override here always wins over the automatic reading (e.g. to
-- waive a stale-feed gate after a verified manual load). One row per step_code
-- per period — re-deciding updates in place.
CREATE TABLE IF NOT EXISTS close.close_step_override (
  override_id  bigserial PRIMARY KEY,
  period       varchar(7) NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  step_code    varchar(40) NOT NULL,
  status       varchar(10) NOT NULL CHECK (status IN ('DONE','NA','BLOCKED')),
  note         text,
  actor        varchar(120) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period, step_code)
);
CREATE INDEX IF NOT EXISTS ix_close_step_override_period ON close.close_step_override (period);

-- ---------------------------------------------------------------- close agent
INSERT INTO agent.agent_registry
(agent_code, agent_name, purpose, owner_name, reviewer_name, runner_type, inputs, data_sources, instructions, kpi_definitions, materiality_gbp, outputs_description, exclusions, approval_required, escalation_rules, data_permissions, risk_rating)
VALUES
('CLOSE_STATUS', 'Close Readiness Agent',
 'Report month-end close readiness for the latest loaded period: which gates are met, what is still blocking, and whether the period is ready to lock.',
 'Kris', 'Kris', 'RULE',
 'The current close run and its automatically-evaluated gates: actuals loaded, feed freshness, pre-close exceptions, workstream playbook, month-end tasks and trading commentary.',
 'finance.fact_financials, finance.nominal_expectation, finance.preclose_review, finance.ma_close_action(_state), workflow.task_instance, agent.agent_output, governance.data_refresh_log, close.close_run/close_step_override (READ-ONLY)',
 'Gather the machine-checkable close signals read-only, evaluate the close plan (lib/close-plan-rules.js), and emit one status REPORT summarising readiness and listing any outstanding blockers. Read-only: the agent never locks a period or ticks a step — a person does that in the Close Cockpit.',
 'Readiness score = satisfied gate steps / total gate steps. A period is ready to lock when there are no outstanding blockers.',
 NULL,
 'One status REPORT per run summarising readiness and listing the outstanding blockers (informational — the report is not material, so it closes automatically and is recorded in the agent run history). The live readiness view is the Close Cockpit.',
 'Does not lock periods, tick steps, post journals or change any data. Reports readiness only.',
 false,
 'If the period cannot be locked by the target working day, escalate the outstanding blockers to the finance lead.',
 'READ-ONLY across finance, workflow, agent and close schemas. No write path other than the agent.* run/output records.',
 'LOW')
ON CONFLICT (agent_code) DO NOTHING;

INSERT INTO agent.agent_version (agent_code, version_number, config, created_by)
SELECT r.agent_code, 1, to_jsonb(r), 'migration 035'
FROM agent.agent_registry r
WHERE r.agent_code = 'CLOSE_STATUS'
  AND NOT EXISTS (SELECT 1 FROM agent.agent_version v WHERE v.agent_code = 'CLOSE_STATUS' AND v.version_number = 1);

INSERT INTO agent.agent_performance (agent_code)
VALUES ('CLOSE_STATUS')
ON CONFLICT (agent_code) DO NOTHING;

COMMIT;
