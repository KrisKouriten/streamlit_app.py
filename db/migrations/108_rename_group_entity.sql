-- Migration 108 — Rename the group entity to "Miniso UK — Limited"
-- The group legal entity (entity_code K-LIMITED, legal_name Kouriten Limited)
-- was shown house-style as "Miniso UK — Group". Rename its display name to
-- "Miniso UK — Limited". Everything references the entity by entity_id, so this
-- one rename updates every entry that uses it (intercompany ledgers, the P.O
-- entity-to-be-invoiced, pickers and reports). legal_name is unchanged — it
-- stays the registered name for statutory / Xero / Joiin mapping.
--
-- Idempotent. Safe to re-run.
--
-- ROLLBACK:
--   UPDATE core.dim_entity SET entity_name = 'Miniso UK — Group' WHERE entity_code = 'K-LIMITED';

BEGIN;

UPDATE core.dim_entity
   SET entity_name = 'Miniso UK — Limited'
 WHERE entity_code = 'K-LIMITED';

COMMIT;
