-- Migration 066 — Merchandising procurement request (OTB-controlled)
-- Extends the existing procurement tracker (finance.procurement_purchase) into the
-- merchandising purchasing workflow controlled by an approved Open-to-Buy plan.
-- A merch request identifies a purchase CHANNEL, links to an OTB version + period,
-- carries the date ladder, landed cost and OTB validation outcome, and can generate
-- or link to a formal P.O — so merchandising never rekeys the same information.
-- Existing cash-tracker rows (channel_code NULL) are untouched.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK: ALTER TABLE finance.procurement_purchase
--   DROP COLUMN IF EXISTS channel_code, ... (all columns below);

BEGIN;

ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS channel_code        varchar(20);   -- MINISO_MDS / LOCAL_PURCHASE
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS otb_version_id      bigint;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS otb_period          char(7);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS request_status      varchar(24);   -- DRAFT / MERCH_REVIEW / OTB_VALIDATED / FINANCE_REVIEW / APPROVED / ORDERED / SHIPPED / IN_TRANSIT / RECEIVED / ALLOCATED / CLOSED / REJECTED
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS sku_or_range        varchar(200);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS units               numeric(20,4);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS currency            varchar(10);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS fx_rate             numeric(14,6);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS freight             numeric(18,2);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS duty                numeric(18,2);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS landed_cost         numeric(18,2);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS request_date        date;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS expected_order_date date;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS expected_shipment_date date;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS expected_receipt_date date;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS expected_availability_date date;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS linked_store        varchar(120);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS new_store_flag      boolean NOT NULL DEFAULT false;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS bau_flag            boolean NOT NULL DEFAULT true;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS clearance_replacement_flag boolean NOT NULL DEFAULT false;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS reason              text;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS po_id               bigint;   -- generated P.O (finance.purchase_order)
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS validation_status   varchar(20);   -- WITHIN_OTB / OTB_WARNING / EXCEEDS_OTB / NO_APPROVED_OTB / APPROVED_EXCEPTION
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS exception_by        varchar(160);
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS exception_reason    text;
ALTER TABLE finance.procurement_purchase ADD COLUMN IF NOT EXISTS exception_at        timestamptz;

CREATE INDEX IF NOT EXISTS ix_procurement_merch_otb
  ON finance.procurement_purchase (otb_version_id, channel_code, otb_period)
  WHERE channel_code IS NOT NULL;

COMMIT;
