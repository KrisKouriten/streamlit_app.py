-- ============================================================================
-- Migration 007 — Real entity register
--
-- Replaces the demo entities with Miniso UK's real legal entities. Adds a
-- legal_name column (the exact registered name, for statutory / Xero mapping);
-- entity_name stays house-style ("Miniso UK — <location>"). The three demo
-- entities (MUK, MUK-RET, MUK-FRAN) are soft-retired (is_active = false), not
-- deleted, so nothing referencing them breaks. Cambridge (KCL) is kept as-is —
-- it already carries the real Xero load — and only gets its legal_name set.
--
-- Idempotent: safe to re-run (inserts guard on legal_name / entity_code).
--
-- ROLLBACK (manual): reactivate demo entities, delete the inserted rows, drop col:
--   UPDATE core.dim_entity SET is_active = true WHERE entity_code IN ('MUK','MUK-RET','MUK-FRAN');
--   DELETE FROM core.dim_entity WHERE legal_name LIKE 'Kouriten %' AND entity_code <> 'KCL';
--   DELETE FROM core.dim_entity WHERE legal_name = 'ISSHO Birmingham Limited';
--   ALTER TABLE core.dim_entity DROP COLUMN IF EXISTS legal_name;
-- ============================================================================
BEGIN;

ALTER TABLE core.dim_entity ADD COLUMN IF NOT EXISTS legal_name varchar(200);

-- Cambridge keeps its data; just record its legal name.
UPDATE core.dim_entity SET legal_name = 'Kouriten Cambridge Limited', entity_type = 'STORE'
 WHERE entity_code = 'KCL';

-- Soft-retire the demo entities (kept for referential integrity of demo rows).
UPDATE core.dim_entity SET is_active = false
 WHERE entity_code IN ('MUK', 'MUK-RET', 'MUK-FRAN') AND legal_name IS NULL;

-- Load the real entities.
INSERT INTO core.dim_entity (entity_code, entity_name, legal_name, entity_type, currency_code, is_active, valid_from)
SELECT v.code, v.name, v.legal, v.etype, 'GBP', true, DATE '2026-01-01'
FROM (VALUES
  ('K-BRENTCROS','Miniso UK — Brent Cross','Kouriten Brent Cross Limited','STORE'),
  ('K-BRIGHTON','Miniso UK — Brighton','Kouriten Brighton Limited','STORE'),
  ('K-CALEDONIA','Miniso UK — Caledonia','Kouriten Caledonia Limited','STORE'),
  ('K-CAMDEN','Miniso UK — Camden','Kouriten Camden Limited','STORE'),
  ('K-CARDIFF','Miniso UK — Cardiff','Kouriten Cardiff Limited','STORE'),
  ('K-CASTLE','Miniso UK — Castle','Kouriten Castle Limited','STORE'),
  ('K-EALING','Miniso UK — Ealing','Kouriten Ealing Limited','STORE'),
  ('K-EASTBOURN','Miniso UK — Eastbourne','Kouriten Eastbourne Limited','STORE'),
  ('K-ECOM','Miniso UK — E-Commerce','Kouriten E-COM Limited','FUNCTION'),
  ('K-FRANCHISE','Miniso UK — Franchise','Kouriten Franchise Limited','FUNCTION'),
  ('K-HOLDINGS','Miniso UK — Holdings','Kouriten Holdings Limited','HOLDING'),
  ('K-KINGSTON','Miniso UK — Kingston','Kouriten Kingston Limited','STORE'),
  ('K-LIMITED','Miniso UK — Group','Kouriten Limited','GROUP'),
  ('K-LEEDS','Miniso UK — Leeds','Kouriten Leeds Limited','STORE'),
  ('K-LUTON','Miniso UK — Luton','Kouriten Luton Limited','STORE'),
  ('K-MEADOWHAL','Miniso UK — Meadowhall','Kouriten Meadowhall Limited','STORE'),
  ('K-NOTTINGHA','Miniso UK — Nottingham','Kouriten Nottingham Limited','STORE'),
  ('K-OUTLET','Miniso UK — Outlet','Kouriten Outlet Limited','FUNCTION'),
  ('K-OXFORD','Miniso UK — Oxford','Kouriten Oxford Limited','STORE'),
  ('K-OXFORDSTR','Miniso UK — Oxford Street','Kouriten Oxford Street Limited','STORE'),
  ('K-SHAFTESBU','Miniso UK — Shaftesbury','Kouriten Shaftesbury Limited','STORE'),
  ('K-SOUTHWEST','Miniso UK — Southwest','Kouriten Southwest Limited','STORE'),
  ('K-STORES','Miniso UK — Stores','Kouriten Stores Limited','FUNCTION'),
  ('K-WESTLONDO','Miniso UK — West London','Kouriten West London Limited','STORE'),
  ('ISSHO-BIR','ISSHO — Birmingham','ISSHO Birmingham Limited','BRAND')
) AS v(code, name, legal, etype)
WHERE NOT EXISTS (
  SELECT 1 FROM core.dim_entity e WHERE e.legal_name = v.legal OR e.entity_code = v.code
);

COMMIT;
