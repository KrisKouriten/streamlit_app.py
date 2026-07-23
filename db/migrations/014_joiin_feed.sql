-- Migration 014 — Joiin consolidated feed (Phase 11)
-- Joiin replaces the per-entity Xero connection as the statutory finance feed:
-- one consolidation across all 26 group companies, eliminations applied.
-- This migration adds feed metadata; the actual monthly figures load separately
-- (real financials — not in the repo). Dashboards prefer JOIIN rows when
-- present and fall back to XERO otherwise. Additive and idempotent.
--
-- ROLLBACK:
--   DELETE FROM finance.fact_financials WHERE source_system = 'JOIIN';
--   DROP TABLE IF EXISTS finance.feed_meta;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.feed_meta (
  source_system  varchar(60) PRIMARY KEY,
  label          varchar(120) NOT NULL,
  unit_count     integer,
  notes          text,
  last_loaded_at timestamptz
);

INSERT INTO finance.feed_meta (source_system, label, unit_count, notes) VALUES
  ('JOIIN', 'Joiin consolidation', 26,
   'All group companies consolidated in Joiin (25 Xero orgs + group cashflow), intercompany eliminations applied. Cash-flow-company artifacts (opening cash, loans, capex) are excluded from the P&L feed.'),
  ('XERO', 'Direct Xero connection', 1, 'Per-entity Xero feed (superseded by Joiin).')
ON CONFLICT (source_system) DO NOTHING;

COMMIT;
