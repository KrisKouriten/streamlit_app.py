-- Migration 010 — DASHBOARDS pillar (Phase 8)
-- Gathers the seven specialist dashboards out of the PLAN / PERFORM / OPERATE
-- pillars into a single DASHBOARDS section, in the order Kris set, and points the
-- breadcrumb owner at it. Additive and idempotent. Safe to re-run.
--
-- Nav works in the app without this (the DASHBOARDS hub lists the seven from
-- code); this migration only reassigns the registry so the OPERATE and WORKFLOW
-- hub pages stop listing the analytical dashboards as their own cards.
--
-- ROLLBACK (restores the Phase 1 pillar assignment):
--   UPDATE intelligence.dashboard_registry SET nav_pillar = 'PLAN'    WHERE dashboard_code = 'BUDGET_FORECAST';
--   UPDATE intelligence.dashboard_registry SET nav_pillar = 'PERFORM' WHERE dashboard_code = 'MANAGEMENT_ACCOUNTS';
--   UPDATE intelligence.dashboard_registry SET nav_pillar = 'OPERATE'
--     WHERE dashboard_code IN ('STORE_SALES_KPI','FRANCHISE','FIXED_ASSETS','INVENTORY','CASHFLOW');

BEGIN;

UPDATE intelligence.dashboard_registry SET nav_pillar = v.pillar, display_order = v.ord
FROM (VALUES
  ('MANAGEMENT_ACCOUNTS', 'DASHBOARDS', 1),
  ('BUDGET_FORECAST',     'DASHBOARDS', 2),
  ('CASHFLOW',            'DASHBOARDS', 3),
  ('STORE_SALES_KPI',     'DASHBOARDS', 4),
  ('INVENTORY',           'DASHBOARDS', 5),
  ('FRANCHISE',           'DASHBOARDS', 6),
  ('FIXED_ASSETS',        'DASHBOARDS', 7)
) AS v(code, pillar, ord)
WHERE dashboard_registry.dashboard_code = v.code;

COMMIT;
