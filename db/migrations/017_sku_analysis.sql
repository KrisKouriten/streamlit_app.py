-- Migration 017 — SKU analysis (Phase 14)
-- DASHBOARDS → SKU Analysis: 80/20 sellers, new-SKU performance, dormant SKUs,
-- from a per-SKU metrics table (TTM revenue/units, launch & last-sold month).
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: DROP TABLE IF EXISTS commercial.sku_metric;

BEGIN;

CREATE TABLE IF NOT EXISTS commercial.sku_metric (
  sku           varchar(40) PRIMARY KEY,
  description   varchar(160),
  category      varchar(80),
  launch_ym     varchar(7),                 -- 'YYYY-MM' first sold / listed
  last_sold_ym  varchar(7),                 -- 'YYYY-MM' most recent sale
  units_ttm     numeric(20,2) NOT NULL DEFAULT 0,
  revenue_ttm   numeric(20,2) NOT NULL DEFAULT 0,
  margin_pct    numeric(9,4),
  stock_value   numeric(20,2) NOT NULL DEFAULT 0,
  source_tag    varchar(60) NOT NULL DEFAULT 'MANUAL',
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Illustrative seed (clearly tagged; replaced on first real upload) — a spread
-- of strong sellers, recent launches and dormant lines around mid-2026.
INSERT INTO commercial.sku_metric (sku, description, category, launch_ym, last_sold_ym, units_ttm, revenue_ttm, margin_pct, stock_value, source_tag)
SELECT * FROM (VALUES
  ('SKU-1001','Aroma Diffuser — White','Home', '2024-03','2026-06', 41200::numeric, 618000::numeric, 0.58, 42000::numeric, 'ILLUSTRATIVE'),
  ('SKU-1002','Plush Bear 30cm','Toys', '2024-06','2026-06', 52800::numeric, 475200::numeric, 0.62, 51000::numeric, 'ILLUSTRATIVE'),
  ('SKU-1003','Ceramic Mug 350ml','Home', '2023-11','2026-06', 63500::numeric, 317500::numeric, 0.55, 22000::numeric, 'ILLUSTRATIVE'),
  ('SKU-1004','Wireless Earbuds','Electronics', '2025-01','2026-06', 9800::numeric, 294000::numeric, 0.41, 61000::numeric, 'ILLUSTRATIVE'),
  ('SKU-1005','Notebook A5 Lined','Stationery', '2023-05','2026-06', 88000::numeric, 220000::numeric, 0.64, 12000::numeric, 'ILLUSTRATIVE'),
  ('SKU-1006','Scented Candle Trio','Home', '2024-09','2026-06', 24100::numeric, 168700::numeric, 0.60, 18500::numeric, 'ILLUSTRATIVE'),
  ('SKU-2101','Summer Tote Bag 2026','Accessories', '2026-05','2026-06', 6400::numeric, 96000::numeric, 0.57, 28000::numeric, 'ILLUSTRATIVE'),
  ('SKU-2102','Mini Fan — Rechargeable','Electronics', '2026-04','2026-06', 7100::numeric, 78100::numeric, 0.45, 19000::numeric, 'ILLUSTRATIVE'),
  ('SKU-2103','Character Keyring S2','Toys', '2026-06','2026-06', 3200::numeric, 22400::numeric, 0.66, 9000::numeric, 'ILLUSTRATIVE'),
  ('SKU-3001','Winter Gloves 2025','Accessories', '2024-10','2025-12', 0::numeric, 0::numeric, 0.50, 31000::numeric, 'ILLUSTRATIVE'),
  ('SKU-3002','Advent Calendar 2025','Seasonal', '2024-09','2025-11', 0::numeric, 0::numeric, 0.48, 47000::numeric, 'ILLUSTRATIVE'),
  ('SKU-3003','Glass Storage Jar (old)','Home', '2023-02','2025-09', 120::numeric, 900::numeric, 0.52, 14500::numeric, 'ILLUSTRATIVE')
) AS v(sku, description, category, launch_ym, last_sold_ym, units_ttm, revenue_ttm, margin_pct, stock_value, source_tag)
WHERE NOT EXISTS (SELECT 1 FROM commercial.sku_metric);

COMMIT;
