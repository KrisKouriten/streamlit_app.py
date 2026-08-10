-- 093_procurement_dc.sql
-- Give the Documentary Credit (DC) a value of its own so a Miniso request's LCs
-- can be grouped under their DC reference and reported as used vs balance
-- remaining. Until now dc_reference lived only as free text on each LC
-- (migration 084) with nowhere to record the DC's total value.
--
-- A DC belongs to a request (procurement_purchase) and is keyed by its
-- reference within that request; its child LCs are matched by dc_reference
-- (case-insensitive), so no change to procurement_lc is needed — the existing
-- text column stays the grouping key.
--
--   procurement_purchase (request)
--     └─ procurement_dc  (DC reference + dc_value)      ← new
--          └─ procurement_lc (LC drawing: amount + dates)  matched on dc_reference
--
-- used      = Σ its LCs' lc_amount   (LC-amount-logged basis)
-- remaining = dc_value − used
--
-- Existing DC references already logged on LCs are seeded as DC records with a
-- NULL value (Finance keys the real value in the app). Additive + idempotent.
--
-- ROLLBACK: DROP TABLE IF EXISTS finance.procurement_dc;

BEGIN;

CREATE TABLE IF NOT EXISTS finance.procurement_dc (
  dc_id         bigserial PRIMARY KEY,
  purchase_id   bigint NOT NULL REFERENCES finance.procurement_purchase(purchase_id) ON DELETE CASCADE,
  dc_reference  varchar(120) NOT NULL,
  dc_value      numeric(18,2),
  currency      varchar(3),
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One DC reference per request (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_dc_ref
  ON finance.procurement_dc (purchase_id, lower(dc_reference));
CREATE INDEX IF NOT EXISTS ix_procurement_dc_purchase
  ON finance.procurement_dc (purchase_id);

-- Seed a DC record for every distinct DC reference already present on LCs, so
-- existing groupings appear straight away (value left NULL to be keyed in-app).
INSERT INTO finance.procurement_dc (purchase_id, dc_reference, currency)
SELECT DISTINCT l.purchase_id, btrim(l.dc_reference), p.currency
FROM finance.procurement_lc l
JOIN finance.procurement_purchase p ON p.purchase_id = l.purchase_id
WHERE l.dc_reference IS NOT NULL AND btrim(l.dc_reference) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM finance.procurement_dc d
    WHERE d.purchase_id = l.purchase_id AND lower(d.dc_reference) = lower(btrim(l.dc_reference))
  );

COMMIT;
