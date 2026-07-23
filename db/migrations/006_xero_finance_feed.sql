-- ============================================================================
-- Migration 006 — Real Xero finance feed (Phase 6)
--
-- Adds the scaffolding for real, consolidated statutory finance from Xero,
-- alongside (not replacing) the demo data. Real rows are tagged
-- source_system = 'XERO'; demo rows stay tagged 'DEMO', so every finance query
-- can ask for one or the other. Consolidation is by entity: each connected Xero
-- organisation maps to one core.dim_entity row, and the connected-entity
-- registry (finance.xero_org_map) records which entities have a live feed so the
-- dashboards can honestly show "N of M entities connected".
--
-- Idempotent: safe to re-run. Only Kouriten Cambridge Limited is connected today.
--
-- ROLLBACK (manual):
--   DELETE FROM finance.xero_org_map;
--   DROP TABLE IF EXISTS finance.xero_org_map;
--   ALTER TABLE finance.fact_bank_position DROP COLUMN IF EXISTS source_system;
--   DELETE FROM core.dim_scenario WHERE scenario_code = 'XERO-ACT';
--   -- (leave dim_entity KCL in place if any facts reference it; else:)
--   -- DELETE FROM core.dim_entity WHERE entity_code = 'KCL';
-- ============================================================================
BEGIN;

-- 1. Connected legal entity. House style: entity_name uses "Miniso UK"; the full
--    legal name is held in finance.xero_org_map where the org must be named exactly.
INSERT INTO core.dim_entity (entity_code, entity_name, entity_type, parent_entity_id, currency_code, is_active, valid_from)
SELECT 'KCL', 'Miniso UK — Cambridge', 'LEGAL_ENTITY',
       (SELECT entity_id FROM core.dim_entity WHERE entity_code = 'MUK'),
       'GBP', true, DATE '2026-01-01'
WHERE NOT EXISTS (SELECT 1 FROM core.dim_entity WHERE entity_code = 'KCL');

-- 2. A dedicated ACTUAL scenario for Xero-sourced actuals, kept separate from the
--    demo ACTUAL scenario so the two never blend even before source filtering.
INSERT INTO core.dim_scenario (scenario_code, scenario_type, scenario_name)
SELECT 'XERO-ACT', 'ACTUAL', 'Xero actuals'
WHERE NOT EXISTS (SELECT 1 FROM core.dim_scenario WHERE scenario_code = 'XERO-ACT');

-- 3. Connected-entity registry: one row per Xero organisation we consolidate.
--    feed_status = CONNECTED (live) | PENDING (planned, not yet wired).
CREATE TABLE IF NOT EXISTS finance.xero_org_map (
    xero_org_id     varchar(80)  PRIMARY KEY,
    xero_org_name   varchar(200) NOT NULL,
    entity_id       bigint       NOT NULL REFERENCES core.dim_entity(entity_id),
    feed_status     varchar(20)  NOT NULL DEFAULT 'CONNECTED',
    last_loaded_at  timestamptz,
    connected_at    timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO finance.xero_org_map (xero_org_id, xero_org_name, entity_id, feed_status)
SELECT '250d62d9-4595-44e5-b218-3b279c9326ee', 'Kouriten Cambridge Limited',
       (SELECT entity_id FROM core.dim_entity WHERE entity_code = 'KCL'), 'CONNECTED'
WHERE NOT EXISTS (
    SELECT 1 FROM finance.xero_org_map WHERE xero_org_id = '250d62d9-4595-44e5-b218-3b279c9326ee'
);

-- 4. Source tag on bank positions (fact_financials already has source_system).
ALTER TABLE finance.fact_bank_position ADD COLUMN IF NOT EXISTS source_system varchar(40);
UPDATE finance.fact_bank_position SET source_system = 'DEMO' WHERE source_system IS NULL;

COMMIT;
