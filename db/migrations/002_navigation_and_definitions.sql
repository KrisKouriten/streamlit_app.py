-- Migration 002 — navigation registry, KPI definition sign-offs, refresh-log backfill (Phase 1)
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE intelligence.dashboard_registry DROP COLUMN IF EXISTS nav_pillar, DROP COLUMN IF EXISTS route;
--   DELETE FROM governance.signoff_log WHERE process_name = 'KPI definition sign-off';
--   DELETE FROM governance.data_refresh_log WHERE source_system = 'Excel model v0.1 (manual load)';
--   (dim_kpi rows added here can be deactivated with is_active = false)

-- 1. Navigation metadata on the dashboard registry
ALTER TABLE intelligence.dashboard_registry
  ADD COLUMN IF NOT EXISTS nav_pillar varchar(20),
  ADD COLUMN IF NOT EXISTS route varchar(160);

UPDATE intelligence.dashboard_registry SET nav_pillar = v.pillar, route = v.route
FROM (VALUES
  ('MASTER',              'HOME',    '/finance-os/executive'),
  ('BUDGET_FORECAST',     'PLAN',    '/finance-os/budget-forecast'),
  ('MANAGEMENT_ACCOUNTS', 'PERFORM', '/finance-os/management-accounts'),
  ('STORE_SALES_KPI',     'OPERATE', '/finance-os/store-sales'),
  ('FRANCHISE',           'OPERATE', '/finance-os/franchise'),
  ('FIXED_ASSETS',        'OPERATE', '/finance-os/fixed-assets'),
  ('INVENTORY',           'OPERATE', '/finance-os/inventory'),
  ('CASHFLOW',            'OPERATE', '/finance-os/cashflow')
) AS v(code, pillar, route)
WHERE dashboard_registry.dashboard_code = v.code;

-- 2. Signed-off store KPI definitions in the governed catalogue (approved 20/07/2026)
INSERT INTO intelligence.dim_kpi
(kpi_code, kpi_name, dashboard_domain, description, calculation_logic, unit_of_measure, favourable_direction, frequency, business_owner, finance_owner)
VALUES
('STORE_ATV', 'Average Transaction Value', 'STORES',
 'Average customer spend per completed transaction. SIGNED OFF: net basis, 20/07/2026.',
 'Net sales (ex VAT) / net transactions', 'GBP', 'UP', 'Daily', 'Operations', 'Kris'),
('STORE_CONVERSION', 'Store Conversion', 'STORES',
 'Share of visitors who transact.',
 'Net transactions / footfall in', 'PERCENT', 'UP', 'Daily', 'Operations', 'Kris'),
('STORE_LFL_SALES', 'Like-for-like Net Sales Growth', 'STORES',
 'Comparable-store sales growth. SIGNED OFF: LFL = stores trading in both compared windows with at least 4 weeks'' trading history before the window starts; prior year = same calendar dates minus 365 days; head-office tills excluded, 20/07/2026.',
 '(LFL net sales CY / LFL net sales PY) - 1', 'PERCENT', 'UP', 'Weekly', 'Operations', 'Kris')
ON CONFLICT (kpi_code) DO UPDATE SET
  description = EXCLUDED.description,
  calculation_logic = EXCLUDED.calculation_logic;

INSERT INTO governance.signoff_log (process_name, period_end, prepared_by, approved_by, status, prepared_at, approved_at, comments)
SELECT 'KPI definition sign-off', DATE '2026-07-20', 'Claude (Finance OS build)', 'Kris', 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       'ATV on net basis; LFL = both windows + 4wk history, PY = -365 days; head-office tills excluded from store reporting.'
WHERE NOT EXISTS (
  SELECT 1 FROM governance.signoff_log
  WHERE process_name = 'KPI definition sign-off' AND period_end = DATE '2026-07-20'
);

-- 3. Backfill the data refresh log for the store-data loads already performed,
--    so freshness stamps have a source. Future loads must write here too.
INSERT INTO governance.data_refresh_log (dashboard_code, source_system, started_at, completed_at, status, rows_loaded)
SELECT 'STORE_SALES_KPI', 'Excel model v0.1 (manual load)',
       MIN(loaded_at), MAX(loaded_at), 'SUCCESS', COUNT(*)
FROM commercial.fact_store_sales s
JOIN core.dim_store st ON st.store_id = s.store_id
WHERE st.operator_name IS NOT NULL
HAVING COUNT(*) > 0
  AND NOT EXISTS (
    SELECT 1 FROM governance.data_refresh_log
    WHERE dashboard_code = 'STORE_SALES_KPI' AND source_system = 'Excel model v0.1 (manual load)'
  );
