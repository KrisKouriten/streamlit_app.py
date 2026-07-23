-- Migration 011 — restore the PLAN pillar (Phase 8 follow-up)
-- PLAN returns as its own tab after HOME, hosting Budget & Forecast. This moves
-- the BUDGET_FORECAST registry row back to the PLAN pillar so the PLAN hub lists
-- it; it still appears in the DASHBOARDS hub (that hub lists its seven from code).
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   UPDATE intelligence.dashboard_registry SET nav_pillar = 'DASHBOARDS', display_order = 2
--     WHERE dashboard_code = 'BUDGET_FORECAST';

BEGIN;

UPDATE intelligence.dashboard_registry
SET nav_pillar = 'PLAN', display_order = 1
WHERE dashboard_code = 'BUDGET_FORECAST';

COMMIT;
