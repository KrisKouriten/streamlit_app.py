-- Migration 072 — a sample Open-to-Buy version so the OTB workspace shows a
-- finished, populated plan out of the box (launch polish). Seeds ONE clearly
-- labelled example version ("FY26 OTB — Sample (seed)") with assumptions, store
-- sales, an inventory position, one open commitment, the new-store / closure /
-- clearance registers, and the computed OTB components (incl. REMAINING_OTB) for
-- Miniso MDS and Local Purchase. Reads nothing; only seeds the merch.* tables the
-- workspace already renders. Purely illustrative and safe to delete:
--   DELETE FROM merch.otb_version WHERE label = 'FY26 OTB — Sample (seed)';  -- cascades
--
-- Additive and idempotent — every block is guarded, so re-running changes nothing.
-- Requires the merch schema (migration 065). Wrapped in one transaction.

BEGIN;

-- 1) The version (only if it isn't already there).
INSERT INTO merch.otb_version (label, fiscal_year, sales_source, scenario_code, inventory_through, status, notes, created_by)
SELECT 'FY26 OTB — Sample (seed)', 2026, 'MANUAL', 'BASE', DATE '2026-06-30', 'DRAFT',
       'Illustrative sample so the workspace shows a populated plan. Safe to delete.', 'migration 072'
WHERE NOT EXISTS (SELECT 1 FROM merch.otb_version WHERE label = 'FY26 OTB — Sample (seed)');

-- 2) Assumptions per channel.
INSERT INTO merch.otb_assumption (otb_version_id, channel_code, cos_rate, gross_margin_rate, target_stock_weeks, clearance_realisation, transit_confidence, tolerance_pct, notes)
SELECT v.otb_version_id, x.ch, x.cos, x.gm, x.weeks, 0.70, 0.90, 0.05, 'Sample'
FROM merch.otb_version v
CROSS JOIN (VALUES
  ('MINISO_MDS',     0.60, 0.40, 8),
  ('LOCAL_PURCHASE', 0.55, 0.45, 6)
) AS x(ch, cos, gm, weeks)
WHERE v.label = 'FY26 OTB — Sample (seed)'
ON CONFLICT (otb_version_id, channel_code) DO NOTHING;

-- 3) Store sales (two stores × two channels) — approved = sales so reconciliation is within tolerance.
INSERT INTO merch.otb_store_sales (otb_version_id, scenario_code, store_code, period, channel_code, sales_amount, approved_store_sales, mix_pct, source, commentary)
SELECT v.otb_version_id, 'BASE', x.store, '2026-07', x.ch, x.sales, x.sales, x.mix, 'SEED', 'Sample'
FROM merch.otb_version v
CROSS JOIN (VALUES
  ('MN-LON-01', 'MINISO_MDS',     500000, 80.6),
  ('MN-LON-01', 'LOCAL_PURCHASE', 120000, 19.4),
  ('MN-MAN-02', 'MINISO_MDS',     300000, 78.9),
  ('MN-MAN-02', 'LOCAL_PURCHASE',  80000, 21.1)
) AS x(store, ch, sales, mix)
WHERE v.label = 'FY26 OTB — Sample (seed)'
ON CONFLICT (otb_version_id, scenario_code, store_code, period, channel_code) DO NOTHING;

-- 4) Inventory position (store / warehouse / in-transit per channel). Guarded as a block.
INSERT INTO merch.otb_inventory_position (otb_version_id, channel_code, location_type, units, stock_value, reserved_value, damaged_value, confidence, data_through, source_tag)
SELECT v.otb_version_id, x.ch, x.loc, 0, x.sv, x.rv, x.dv, x.cf, DATE '2026-06-30', 'SEED'
FROM merch.otb_version v
CROSS JOIN (VALUES
  ('MINISO_MDS',     'STORE',      300000,     0,     0, 1.0),
  ('MINISO_MDS',     'WAREHOUSE',  500000, 50000, 20000, 1.0),
  ('MINISO_MDS',     'IN_TRANSIT', 150000,     0,     0, 0.9),
  ('LOCAL_PURCHASE', 'STORE',       80000,     0,     0, 1.0),
  ('LOCAL_PURCHASE', 'WAREHOUSE',  120000, 10000,  5000, 1.0),
  ('LOCAL_PURCHASE', 'IN_TRANSIT',  40000,     0,     0, 0.9)
) AS x(ch, loc, sv, rv, dv, cf)
WHERE v.label = 'FY26 OTB — Sample (seed)'
  AND NOT EXISTS (SELECT 1 FROM merch.otb_inventory_position ip WHERE ip.otb_version_id = v.otb_version_id AND ip.source_tag = 'SEED');

-- 5) One open commitment.
INSERT INTO merch.otb_commitment (otb_version_id, channel_code, period, kind, amount, reference, source)
SELECT v.otb_version_id, 'MINISO_MDS', '2026-07', 'OPEN_COMMITMENT', 100000, 'SAMPLE-OC-1', 'SEED'
FROM merch.otb_version v
WHERE v.label = 'FY26 OTB — Sample (seed)'
  AND NOT EXISTS (SELECT 1 FROM merch.otb_commitment c WHERE c.otb_version_id = v.otb_version_id AND c.source = 'SEED');

-- 6) Registers — one new store, one closure, one clearance plan (each guarded).
INSERT INTO merch.new_store_requirement (otb_version_id, store_code, store_name, planned_opening, store_format, channel_code, opening_stock_value, fitout_inventory_value, phase, approved, notes)
SELECT v.otb_version_id, 'MN-BIR-03', 'Birmingham Bullring', DATE '2026-10-01', 'Standard', 'MINISO_MDS', 120000, 30000, 'INITIAL', false, 'Sample'
FROM merch.otb_version v
WHERE v.label = 'FY26 OTB — Sample (seed)'
  AND NOT EXISTS (SELECT 1 FROM merch.new_store_requirement n WHERE n.otb_version_id = v.otb_version_id AND n.store_code = 'MN-BIR-03');

INSERT INTO merch.store_closure (otb_version_id, store_code, closure_date, channel_code, current_stock_value, transferable_value, non_transferable_value, write_off_value, transfer_destination, notes)
SELECT v.otb_version_id, 'MN-GLA-09', DATE '2026-09-30', 'LOCAL_PURCHASE', 60000, 40000, 15000, 5000, 'MN-LON-01', 'Sample'
FROM merch.otb_version v
WHERE v.label = 'FY26 OTB — Sample (seed)'
  AND NOT EXISTS (SELECT 1 FROM merch.store_closure s WHERE s.otb_version_id = v.otb_version_id AND s.store_code = 'MN-GLA-09');

INSERT INTO merch.clearance_plan (otb_version_id, location, channel_code, category, units, stock_value, stock_age_days, proposed_markdown_pct, realisation_rate, status, owner, notes)
SELECT v.otb_version_id, 'London warehouse', 'MINISO_MDS', 'SS25 residual', 8000, 90000, 220, 0.40, 0.70, 'PLANNED', 'Merchandising', 'Sample'
FROM merch.otb_version v
WHERE v.label = 'FY26 OTB — Sample (seed)'
  AND NOT EXISTS (SELECT 1 FROM merch.clearance_plan c WHERE c.otb_version_id = v.otb_version_id AND c.location = 'London warehouse' AND c.category = 'SS25 residual');

-- 7) Computed OTB components (period 'ALL', scenario 'BASE') — this is what makes
--    getOtbSummary().computed = true and the exec tiles + summary table populate.
--    Amounts are the magnitudes; REMAINING_OTB is the net (adds PLANNED_COS +
--    TARGET_CLOSING_STOCK, subtracts opening store/warehouse/in-transit + commitments).
INSERT INTO merch.otb_component (otb_version_id, scenario_code, channel_code, period, component_code, amount)
SELECT v.otb_version_id, 'BASE', x.ch, 'ALL', x.code, x.amt
FROM merch.otb_version v
CROSS JOIN (VALUES
  ('MINISO_MDS',     'PLANNED_COS',             480000.00),
  ('MINISO_MDS',     'TARGET_CLOSING_STOCK',    883774.45),
  ('MINISO_MDS',     'OPENING_STORE_STOCK',     300000.00),
  ('MINISO_MDS',     'OPENING_WAREHOUSE_STOCK', 430000.00),
  ('MINISO_MDS',     'IN_TRANSIT',              135000.00),
  ('MINISO_MDS',     'OPEN_COMMITMENTS',        100000.00),
  ('MINISO_MDS',     'REMAINING_OTB',           398774.45),
  ('LOCAL_PURCHASE', 'PLANNED_COS',             110000.00),
  ('LOCAL_PURCHASE', 'TARGET_CLOSING_STOCK',    151898.73),
  ('LOCAL_PURCHASE', 'OPENING_STORE_STOCK',      80000.00),
  ('LOCAL_PURCHASE', 'OPENING_WAREHOUSE_STOCK',  105000.00),
  ('LOCAL_PURCHASE', 'IN_TRANSIT',               36000.00),
  ('LOCAL_PURCHASE', 'REMAINING_OTB',            40898.73)
) AS x(ch, code, amt)
WHERE v.label = 'FY26 OTB — Sample (seed)'
ON CONFLICT (otb_version_id, scenario_code, channel_code, period, component_code) DO NOTHING;

COMMIT;
