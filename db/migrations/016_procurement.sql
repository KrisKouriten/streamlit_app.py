-- Migration 016 — Procurement (Phase 14)
-- OPERATE → Procurement: Miniso purchases and local purchases, with a monthly
-- cash budget per source. Supplier payment terms decide the cash-out month, so
-- the merch team see committed spend landing against each month's cash budget.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.procurement_budget;
--   DROP TABLE IF EXISTS finance.procurement_purchase;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.procurement_purchase (
  purchase_id   bigserial PRIMARY KEY,
  source        varchar(10) NOT NULL CHECK (source IN ('MINISO','LOCAL')),
  supplier      varchar(120) NOT NULL,
  category      varchar(80),
  order_ym      varchar(7) NOT NULL,              -- 'YYYY-MM' the order is placed
  amount_gbp    numeric(20,2) NOT NULL,
  terms_days    integer NOT NULL DEFAULT 0,       -- supplier payment terms
  status        varchar(12) NOT NULL DEFAULT 'COMMITTED' CHECK (status IN ('COMMITTED','PAID')),
  reference     varchar(120),
  source_tag    varchar(60) NOT NULL DEFAULT 'MANUAL',
  created_by    varchar(120),
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_procurement_source_ym ON finance.procurement_purchase (source, order_ym);

-- Monthly cash budget per source (the merch team's cashflow budget).
CREATE TABLE IF NOT EXISTS finance.procurement_budget (
  source     varchar(10) NOT NULL CHECK (source IN ('MINISO','LOCAL')),
  ym         varchar(7) NOT NULL,
  budget_gbp numeric(20,2) NOT NULL,
  updated_by varchar(120),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, ym)
);

-- Illustrative seed so the screen shows populated (clearly tagged; replaced on
-- first real CSV upload). Only seeds an empty table.
INSERT INTO finance.procurement_budget (source, ym, budget_gbp, updated_by)
SELECT s.source, m.ym, s.budget, 'system'
FROM (VALUES ('MINISO', 900000::numeric), ('LOCAL', 180000::numeric)) AS s(source, budget)
CROSS JOIN (VALUES ('2026-07'),('2026-08'),('2026-09')) AS m(ym)
WHERE NOT EXISTS (SELECT 1 FROM finance.procurement_budget);

INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag)
SELECT * FROM (VALUES
  ('MINISO','MINISO HQ (Guangzhou)','Core range','2026-07', 420000::numeric, 60, 'COMMITTED','PO-MN-4471','ILLUSTRATIVE'),
  ('MINISO','MINISO HQ (Guangzhou)','Seasonal','2026-07', 285000::numeric, 60, 'COMMITTED','PO-MN-4472','ILLUSTRATIVE'),
  ('MINISO','MINISO HQ (Guangzhou)','Core range','2026-08', 510000::numeric, 60, 'COMMITTED','PO-MN-4488','ILLUSTRATIVE'),
  ('LOCAL','Design360','Store fixtures','2026-07', 42000::numeric, 30, 'COMMITTED','PO-LC-2201','ILLUSTRATIVE'),
  ('LOCAL','UK Packaging Co','Packaging','2026-07', 18500::numeric, 30, 'PAID','PO-LC-2202','ILLUSTRATIVE'),
  ('LOCAL','Regional Logistics Ltd','Carriage','2026-08', 26000::numeric, 14, 'COMMITTED','PO-LC-2210','ILLUSTRATIVE')
) AS v(source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag)
WHERE NOT EXISTS (SELECT 1 FROM finance.procurement_purchase);

COMMIT;
