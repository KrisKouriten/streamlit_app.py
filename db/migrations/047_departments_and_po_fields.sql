-- Migration 047 — Governed departments + Purchase Order field changes
-- Seeds the seven operating departments into the governed dimension, tags users
-- with a department (surfaced in Users & Roles), and adjusts the Purchase Order
-- fields: VAT removed (payment value is now net), fulfilment date → start date,
-- fulfilment period expressed in days, and a "Head Office only" recharge option.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE public.users DROP COLUMN IF EXISTS department;
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS fulfilment_start_date;
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS fulfilment_days;
--   ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS recharge_ho_only;
--   -- (VAT / fulfilment_date / fulfilment_period columns are not restored)
--   DELETE FROM core.dim_department WHERE department_code IN ('FIN','MKT','MERCH','OPS','HR','LOG','ARCH');

BEGIN;

-- The governed department list (used by the PO department picker and Users & Roles).
INSERT INTO core.dim_department (department_code, department_name) VALUES
  ('FIN',   'Finance'),
  ('MKT',   'Marketing'),
  ('MERCH', 'Merchandising'),
  ('OPS',   'Operations'),
  ('HR',    'HR'),
  ('LOG',   'Logistics'),
  ('ARCH',  'Architecture & Build')
ON CONFLICT (department_code) DO NOTHING;

-- Users carry a department (assignable in Users & Roles).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS department varchar(120);

-- Purchase order field changes.
ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS vat_amount;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS fulfilment_start_date date;
ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS fulfilment_date;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS fulfilment_days int;
ALTER TABLE finance.purchase_order DROP COLUMN IF EXISTS fulfilment_period;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS recharge_ho_only boolean NOT NULL DEFAULT false;

COMMIT;
