-- 082_procurement_approval.sql
-- Raise / approve / cancel / delete lifecycle on procurement orders, mirroring
-- the P.O workflow: a raised order is PENDING until the Head of Department
-- approves it (HOD_APPROVED), then Finance approves it (APPROVED). Any manager
-- can cancel; only Finance can delete, and only once the Head of Department has
-- approved. Existing rows are treated as already APPROVED so nothing is stranded.
-- Idempotent.

BEGIN;

ALTER TABLE finance.procurement_purchase
  ADD COLUMN IF NOT EXISTS approval_status varchar(16),
  ADD COLUMN IF NOT EXISTS hod_approved_by text,
  ADD COLUMN IF NOT EXISTS hod_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS fin_approved_by text,
  ADD COLUMN IF NOT EXISTS fin_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by    text,
  ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason   text;

-- Existing orders predate the workflow — treat them as already approved.
UPDATE finance.procurement_purchase SET approval_status = 'APPROVED' WHERE approval_status IS NULL;

ALTER TABLE finance.procurement_purchase ALTER COLUMN approval_status SET DEFAULT 'PENDING';
ALTER TABLE finance.procurement_purchase ALTER COLUMN approval_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE finance.procurement_purchase
    ADD CONSTRAINT procurement_approval_status_chk
    CHECK (approval_status IN ('PENDING','HOD_APPROVED','APPROVED','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_procurement_approval ON finance.procurement_purchase (approval_status);

COMMIT;
