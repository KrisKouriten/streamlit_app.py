-- 086_capex_occupancy.sql
-- Capex Investment appraisal: occupancy costs are tracked as their own
-- investment components — Rent, Business rates and Service charge — rather than
-- being lumped into "Other". They count towards the upfront investment (the t0
-- cash outflow) but are operating costs, so they are excluded from the
-- depreciable capex base. Idempotent.

BEGIN;

ALTER TABLE capex.project
  ADD COLUMN IF NOT EXISTS rent            numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_rates  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_charge  numeric(18,2) NOT NULL DEFAULT 0;

COMMIT;
