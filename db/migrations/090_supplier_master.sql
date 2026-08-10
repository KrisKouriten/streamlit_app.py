-- 090_supplier_master.sql
-- Finalise procurement: a canonical supplier master so suppliers are named
-- consistently across procurement requests, P.O requests and the HSBC trade
-- facility, and so each supplier can carry a credit limit (orders vs limit).
-- Plus a small facility-limit store for the overall HSBC facility ceiling.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS finance.supplier;
--   DROP TABLE IF EXISTS finance.trade_facility_limit;

BEGIN;

-- Canonical supplier list. norm_name (lower+trimmed) is the match/dedup key so
-- "Miniso HQ" and "miniso hq " collapse to one supplier; genuinely different
-- spellings ("Miniso HQ" vs "Miniso H") seed as separate rows for an admin to
-- merge. credit_limit NULL = no limit set yet.
CREATE TABLE IF NOT EXISTS finance.supplier (
  supplier_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          varchar(200) NOT NULL,
  norm_name     varchar(200) NOT NULL,
  source_type   varchar(20),                 -- MINISO / LOCAL / OTHER (optional tag)
  currency      char(3) NOT NULL DEFAULT 'GBP',
  credit_limit  numeric(18,2),               -- NULL until finance sets it
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_by    varchar(160),
  updated_by    varchar(160),
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_norm ON finance.supplier (norm_name);

-- Seed the master from every supplier name already in the system (de-duped by
-- normalised name), so the dropdowns have the real list from day one.
INSERT INTO finance.supplier (name, norm_name, source_type, created_by)
SELECT DISTINCT ON (lower(btrim(s.nm)))
       btrim(s.nm), lower(btrim(s.nm)), s.src, 'seed'
FROM (
  SELECT supplier AS nm, source AS src FROM finance.procurement_purchase
    WHERE supplier IS NOT NULL AND btrim(supplier) <> ''
  UNION ALL
  SELECT supplier AS nm, NULL::varchar FROM finance.purchase_order
    WHERE supplier IS NOT NULL AND btrim(supplier) <> ''
  UNION ALL
  SELECT beneficiary AS nm, 'OTHER'::varchar FROM finance.bank_trade_facility
    WHERE beneficiary IS NOT NULL AND btrim(beneficiary) <> ''
) s
ORDER BY lower(btrim(s.nm)), s.src NULLS LAST
ON CONFLICT (norm_name) DO NOTHING;

-- Overall trade-facility ceiling(s). One row per facility (HSBC). limit_gbp NULL
-- until finance enters it; headroom = limit − outstanding drawings.
CREATE TABLE IF NOT EXISTS finance.trade_facility_limit (
  facility    varchar(60) PRIMARY KEY,
  limit_gbp   numeric(18,2),
  notes       text,
  updated_by  varchar(160),
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO finance.trade_facility_limit (facility) VALUES ('HSBC')
ON CONFLICT (facility) DO NOTHING;

COMMIT;
