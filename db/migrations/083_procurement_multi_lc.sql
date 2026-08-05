-- 083_procurement_multi_lc.sql
-- A Miniso procurement request can be settled across several HSBC Letter of
-- Credit applications, so LCs move to a child table (one request → many LCs).
-- The single lc_* columns on procurement_purchase are kept as a maintained
-- rollup (sum of amounts, all-settled flag, etc.) so the Summary + Close list,
-- CSV export and the merchandising roll-up keep working unchanged. Existing
-- single LCs are migrated into a first child row. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS finance.procurement_lc (
  lc_id             bigserial PRIMARY KEY,
  purchase_id       bigint NOT NULL REFERENCES finance.procurement_purchase(purchase_id) ON DELETE CASCADE,
  lc_reference      varchar(120) NOT NULL,
  lc_amount         numeric(18,2),
  lc_bank           varchar(80),
  lc_confirmed_date date,
  lc_payment_date   date,
  lc_settled        boolean NOT NULL DEFAULT false,
  lc_settled_date   date,
  lc_settled_amount numeric(18,2),
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_procurement_lc_purchase ON finance.procurement_lc (purchase_id);

-- Move any already-logged single LC into a first child row (once).
INSERT INTO finance.procurement_lc (purchase_id, lc_reference, lc_amount, lc_bank, lc_confirmed_date, lc_payment_date, lc_settled, lc_settled_date, lc_settled_amount)
SELECT p.purchase_id, p.lc_reference, p.lc_amount, p.lc_bank, p.lc_confirmed_date, p.lc_payment_date,
       COALESCE(p.lc_settled, false), p.lc_settled_date, p.lc_settled_amount
FROM finance.procurement_purchase p
WHERE p.lc_reference IS NOT NULL AND p.lc_reference <> ''
  AND NOT EXISTS (SELECT 1 FROM finance.procurement_lc l WHERE l.purchase_id = p.purchase_id);

COMMIT;
