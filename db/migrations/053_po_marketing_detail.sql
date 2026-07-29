-- Migration 053 — Purchase Orders: marketing budget link + campaign
-- When a P.O's department is Marketing, the request captures which part of the
-- marketing budget it belongs to (campaign costs / one-off projects / new store
-- openings / …) and the campaign name (e.g. "Star Wars", "Toy Story 5"), so the
-- spend links back to the departmental budget and reports cleanly on the
-- Marketing dashboard.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order
--     DROP COLUMN IF EXISTS marketing_budget_category,
--     DROP COLUMN IF EXISTS marketing_campaign;

BEGIN;

ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS marketing_budget_category varchar(80);   -- Campaign costs / One-off projects / New store openings / …
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS marketing_campaign        varchar(200);  -- free-typed or picked from the Marketing budget's campaigns

COMMIT;
