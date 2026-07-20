-- Migration 004 — Finance Agent Control Centre (Phase 3)
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE intelligence.ai_insight DROP COLUMN IF EXISTS agent_run_id, DROP COLUMN IF EXISTS agent_output_id;
--   DROP SCHEMA IF EXISTS agent CASCADE;

CREATE SCHEMA IF NOT EXISTS agent;

-- The governed definition of every agent. An agent is configuration, not loose code.
CREATE TABLE IF NOT EXISTS agent.agent_registry (
    agent_code          varchar(60) PRIMARY KEY,
    agent_name          varchar(160) NOT NULL,
    purpose             text NOT NULL,
    owner_name          varchar(120) NOT NULL,          -- accountable human
    reviewer_name       varchar(120) NOT NULL,          -- default output reviewer
    runner_type         varchar(10) NOT NULL CHECK (runner_type IN ('RULE','LLM')),
    inputs              text,                            -- what it reads, in plain words
    data_sources        text,                            -- tables/views it may SELECT from
    instructions        text NOT NULL,                   -- what it does / how it decides
    kpi_definitions     text,                            -- governed definitions it applies
    materiality_gbp     numeric(20,2),                   -- outputs at/above this are material
    outputs_description text,
    exclusions          text,                            -- what it must NOT opine on
    approval_required   boolean NOT NULL DEFAULT true,   -- material outputs always reviewed
    escalation_rules    text,
    data_permissions    text NOT NULL DEFAULT 'READ-ONLY on finance data; writes limited to agent.* and intelligence.ai_insight via the runner',
    risk_rating         varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (risk_rating IN ('LOW','MEDIUM','HIGH')),
    current_version     integer NOT NULL DEFAULT 1,
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable version snapshots; editing the registry creates a new version row.
CREATE TABLE IF NOT EXISTS agent.agent_version (
    version_id          bigserial PRIMARY KEY,
    agent_code          varchar(60) NOT NULL REFERENCES agent.agent_registry(agent_code),
    version_number      integer NOT NULL,
    config              jsonb NOT NULL,
    created_by          varchar(160),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (agent_code, version_number)
);

-- Prompt history for LLM agents (empty for rule agents).
CREATE TABLE IF NOT EXISTS agent.agent_prompt (
    prompt_id           bigserial PRIMARY KEY,
    agent_code          varchar(60) NOT NULL REFERENCES agent.agent_registry(agent_code),
    version_number      integer NOT NULL,
    prompt_text         text NOT NULL,
    created_by          varchar(160),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Governance controls: capability switches, listed so their state is visible.
CREATE TABLE IF NOT EXISTS agent.agent_control (
    control_code        varchar(60) PRIMARY KEY,
    description         text NOT NULL,
    enabled             boolean NOT NULL DEFAULT false,
    notes               text
);

-- Permanent record of every execution.
CREATE TABLE IF NOT EXISTS agent.agent_run (
    run_id              bigserial PRIMARY KEY,
    agent_code          varchar(60) NOT NULL REFERENCES agent.agent_registry(agent_code),
    version_number      integer NOT NULL,
    trigger_type        varchar(12) NOT NULL CHECK (trigger_type IN ('MANUAL','SCHEDULED')),
    triggered_by        varchar(160) NOT NULL,
    period_start        date,
    period_end          date,
    data_freshness      text,                            -- from governance.data_refresh_log
    plan                text,                            -- what the run intended to do
    status              varchar(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
    summary             text,
    confidence_pct      numeric(9,4),
    started_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_run_agent ON agent.agent_run(agent_code, started_at DESC);

CREATE TABLE IF NOT EXISTS agent.agent_run_step (
    step_id             bigserial PRIMARY KEY,
    run_id              bigint NOT NULL REFERENCES agent.agent_run(run_id),
    step_no             smallint NOT NULL,
    title               varchar(200) NOT NULL,
    detail              text,
    status              varchar(10) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','FAILED','SKIPPED')),
    started_at          timestamptz,
    finished_at         timestamptz
);

-- Outputs move through the controlled lifecycle. Material outputs cannot skip review.
CREATE TABLE IF NOT EXISTS agent.agent_output (
    output_id           bigserial PRIMARY KEY,
    run_id              bigint NOT NULL REFERENCES agent.agent_run(run_id),
    output_type         varchar(20) NOT NULL CHECK (output_type IN ('INSIGHT','EXCEPTION','RECOMMENDATION','REPORT')),
    severity            varchar(10) CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    headline            varchar(250) NOT NULL,
    body                text NOT NULL,
    recommended_action  text,
    financial_impact    numeric(20,2),
    confidence_pct      numeric(9,4),
    is_material         boolean NOT NULL DEFAULT false,
    validation_result   text,
    lifecycle           varchar(24) NOT NULL DEFAULT 'GENERATED'
                        CHECK (lifecycle IN ('GENERATED','AUTOMATED_VALIDATION','PENDING_REVIEW',
                                             'APPROVED','AMENDED','REJECTED','ACTION_CREATED','CLOSED')),
    store_id            bigint REFERENCES core.dim_store(store_id),
    entity_id           bigint REFERENCES core.dim_entity(entity_id),
    insight_id          bigint REFERENCES intelligence.ai_insight(insight_id),
    action_id           bigint REFERENCES intelligence.action_register(action_id),
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_output_lifecycle ON agent.agent_output(lifecycle);

CREATE TABLE IF NOT EXISTS agent.agent_exception (
    exception_id        bigserial PRIMARY KEY,
    run_id              bigint NOT NULL REFERENCES agent.agent_run(run_id),
    severity            varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    message             text NOT NULL,
    is_resolved         boolean NOT NULL DEFAULT false,
    resolved_by         varchar(160),
    resolved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reviewer decisions on outputs (separate, permanent record).
CREATE TABLE IF NOT EXISTS agent.agent_review (
    review_id           bigserial PRIMARY KEY,
    output_id           bigint NOT NULL REFERENCES agent.agent_output(output_id),
    reviewer            varchar(160) NOT NULL,
    decision            varchar(10) NOT NULL CHECK (decision IN ('APPROVED','AMENDED','REJECTED')),
    comment             text,
    amended_headline    varchar(250),
    amended_body        text,
    decided_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-agent rollup, upserted when a run finishes.
CREATE TABLE IF NOT EXISTS agent.agent_performance (
    agent_code          varchar(60) PRIMARY KEY REFERENCES agent.agent_registry(agent_code),
    total_runs          integer NOT NULL DEFAULT 0,
    failed_runs         integer NOT NULL DEFAULT 0,
    total_outputs       integer NOT NULL DEFAULT 0,
    approved_outputs    integer NOT NULL DEFAULT 0,
    rejected_outputs    integer NOT NULL DEFAULT 0,
    last_run_at         timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Link approved outputs back into the insight layer.
ALTER TABLE intelligence.ai_insight
  ADD COLUMN IF NOT EXISTS agent_run_id bigint REFERENCES agent.agent_run(run_id),
  ADD COLUMN IF NOT EXISTS agent_output_id bigint;

-- Hard prohibitions, visible as permanently disabled controls. These
-- capabilities do not exist in the runner; the rows document that fact.
INSERT INTO agent.agent_control (control_code, description, enabled, notes) VALUES
('JOURNAL_POSTING',        'Agents may post accounting journals', false, 'Capability absent from the runner. Enabling requires a build change and governance sign-off.'),
('PAYMENT_RELEASE',        'Agents may release or authorise payments', false, 'Capability absent from the runner.'),
('FORECAST_MUTATION',      'Agents may modify approved forecasts or budgets', false, 'Capability absent from the runner.'),
('EXTERNAL_COMMUNICATION', 'Agents may send external communications', false, 'Capability absent from the runner.'),
('SCHEDULED_RUNS',         'Agents may run on a schedule without a human trigger', false, 'Off until a schedule is configured and approved.')
ON CONFLICT (control_code) DO NOTHING;

-- Seed the first two rule agents (implementations live in lib/agents.js and
-- are selected by agent_code; the registry row is the governed contract).
INSERT INTO agent.agent_registry
(agent_code, agent_name, purpose, owner_name, reviewer_name, runner_type, inputs, data_sources, instructions, kpi_definitions, materiality_gbp, outputs_description, exclusions, approval_required, escalation_rules, risk_rating)
VALUES
('STORE_PRIORITIES', 'Store Priorities Agent', 'Scan every trading store''s year-to-date KPIs against last year and surface the stores that need management attention, with the reason and a recommended first move.',
 'Kris', 'Kris', 'RULE',
 'Daily store sales, transactions, footfall, returns and margin; break-even status from the cost model.',
 'commercial.fact_store_sales, commercial.store_cost_profile, core.dim_store, core.market_assumption',
 'For each active store with at least 4 weeks of history in both years, compute YoY net sales, footfall, conversion, ATV and returns on the governed definitions. Flag: sales down >10%, footfall down >10%, conversion down >5%, returns value up >25%, trading below break-even. Rank flagged stores by estimated annualised sales impact.',
 'ATV = net sales / net transactions. Conversion = net transactions / footfall. LFL basis per the signed-off definitions (20/07/2026).',
 25000.00,
 'One INSIGHT per flagged store with severity, estimated financial impact and a recommended action.',
 'Does not opine on staffing decisions, lease decisions or franchise contract matters.',
 true,
 'CRITICAL outputs (impact >= 100k) should be actioned within one week; escalate to the owner if unreviewed after 3 days.',
 'MEDIUM'),
('DATA_QUALITY', 'Data Quality Agent', 'Check the freshness and integrity of the data behind the dashboards and flag anything that could make a number on screen misleading.',
 'Kris', 'Kris', 'RULE',
 'Data refresh log, daily store sales validity flags, footfall coverage, workflow task status.',
 'governance.data_refresh_log, commercial.fact_store_sales, core.dim_store, workflow.task_instance',
 'Check: (1) age of the latest successful data load vs a 9-day tolerance; (2) share of zero-footfall trading days in the last 4 weeks of data; (3) count of invalid-day rows excluded in the last 4 weeks; (4) overdue critical tasks. Emit one EXCEPTION per failed check with the exact figures.',
 'Freshness = now minus latest SUCCESS completed_at in the refresh log.',
 NULL,
 'EXCEPTION outputs per failed check; a clean REPORT output when all checks pass.',
 'Does not attempt to fix data; reports only.',
 true,
 'Freshness failures should block reliance on the store dashboards until resolved.',
 'LOW')
ON CONFLICT (agent_code) DO NOTHING;

-- Version-1 snapshots for the seeded agents.
INSERT INTO agent.agent_version (agent_code, version_number, config, created_by)
SELECT r.agent_code, 1, to_jsonb(r), 'migration 004'
FROM agent.agent_registry r
WHERE NOT EXISTS (
  SELECT 1 FROM agent.agent_version v WHERE v.agent_code = r.agent_code AND v.version_number = 1
);

INSERT INTO agent.agent_performance (agent_code)
SELECT agent_code FROM agent.agent_registry
ON CONFLICT (agent_code) DO NOTHING;
