-- Migration 033 — Weekly Trading Commentary agent (Tier 2.2, first LLM agent)
-- Registers a governed LLM agent whose implementation lives in lib/agents.js
-- (TRADING_COMMENTARY). It reads the governed company-store YTD figures
-- read-only and asks Claude to draft a short commentary using ONLY those
-- figures — the model gets no tools and no data access. approval_required=true
-- means every draft lands in PENDING_REVIEW for a human to amend or approve.
-- Additive and idempotent.
--
-- ROLLBACK:
--   DELETE FROM agent.agent_performance WHERE agent_code='TRADING_COMMENTARY';
--   DELETE FROM agent.agent_version     WHERE agent_code='TRADING_COMMENTARY';
--   DELETE FROM agent.agent_registry    WHERE agent_code='TRADING_COMMENTARY';

BEGIN;

INSERT INTO agent.agent_registry
(agent_code, agent_name, purpose, owner_name, reviewer_name, runner_type, inputs, data_sources, instructions, kpi_definitions, materiality_gbp, outputs_description, exclusions, approval_required, escalation_rules, data_permissions, risk_rating)
VALUES
('TRADING_COMMENTARY', 'Weekly Trading Commentary Agent',
 'Draft a concise weekly management commentary on company-owned store trading (year-to-date versus last year), for human review before any use.',
 'Kris', 'Kris', 'LLM',
 'Company-store year-to-date net sales and footfall versus the same period last year, and the strongest/weakest stores by year-on-year sales.',
 'commercial.fact_store_sales, core.dim_store, core.dim_scenario, core.dim_date (READ-ONLY)',
 'Gather the governed YTD figures read-only, then ask Claude (claude-opus-4-8) to write 2-4 short paragraphs using ONLY those figures. The model receives no tools and cannot query or write any data. Every draft is recorded in full (plan, steps, output) and always lands in PENDING_REVIEW for a human to amend or approve.',
 'Year-on-year = current-year figure / same-period-last-year figure - 1, on valid trading days only.',
 NULL,
 'One narrative INSIGHT (the drafted commentary) per run, always PENDING_REVIEW.',
 'Uses only the figures supplied in the prompt; must not introduce external facts, give investment advice, or opine on staffing, leases, or franchise matters. Fabricated numbers are the key risk — hence mandatory human review before any use.',
 true,
 'Do not use any drafted commentary externally until a human has reviewed and approved it.',
 'READ-ONLY on finance data; the model has no tools and no write path. Drafts are written only to agent.* and, on approval, to intelligence.ai_insight via the runner.',
 'MEDIUM')
ON CONFLICT (agent_code) DO NOTHING;

-- Version-1 snapshot (mirrors the seed pattern in migration 004).
INSERT INTO agent.agent_version (agent_code, version_number, config, created_by)
SELECT r.agent_code, 1, to_jsonb(r), 'migration 033'
FROM agent.agent_registry r
WHERE r.agent_code = 'TRADING_COMMENTARY'
  AND NOT EXISTS (SELECT 1 FROM agent.agent_version v WHERE v.agent_code = 'TRADING_COMMENTARY' AND v.version_number = 1);

INSERT INTO agent.agent_performance (agent_code)
VALUES ('TRADING_COMMENTARY')
ON CONFLICT (agent_code) DO NOTHING;

COMMIT;
