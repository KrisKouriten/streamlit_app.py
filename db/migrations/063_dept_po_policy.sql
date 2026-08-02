-- Migration 063 — Department self-approved P.O limits
-- Adds a per-department self-approval policy so each department can be given a
-- count limit, a measurement period, an individual-P.O value cap and a cumulative
-- value cap. Once ANY of those is reached the next P.O routes to line-manager (or
-- department) sign-off. This replaces the single org-wide £ self-approval limit
-- with a per-department control; the org-wide governance.app_setting
-- 'po_self_approve_limit' is RETAINED as the fallback for departments that have no
-- policy row, so existing behaviour is preserved until a policy is configured.
--
--   governance.dept_po_policy — one policy per department (upsert).
--   finance.purchase_order    — records the routing decision + any override, and
--                               the policy version applied, for audit.
--
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchase_order
--     DROP COLUMN IF EXISTS approval_route, DROP COLUMN IF EXISTS applied_policy_id,
--     DROP COLUMN IF EXISTS route_override_by, DROP COLUMN IF EXISTS route_override_reason,
--     DROP COLUMN IF EXISTS route_override_at, DROP COLUMN IF EXISTS route_original;
--   DROP TABLE IF EXISTS governance.dept_po_policy;

BEGIN;

-- The per-department self-approval policy. One active row per department.
CREATE TABLE IF NOT EXISTS governance.dept_po_policy (
  policy_id            bigserial PRIMARY KEY,
  department           varchar(120) NOT NULL,
  -- Self-approval COUNT control
  count_limit          int,                         -- max self-approved P.Os per period (NULL = no count cap)
  measurement_period   varchar(24) NOT NULL DEFAULT 'FINANCIAL_PERIOD',
    -- CALENDAR_MONTH / FINANCIAL_PERIOD / CALENDAR_QUARTER / FINANCIAL_YEAR / ROLLING_30_DAYS / CUSTOM_PERIOD
  period_reset_rule    varchar(40),                 -- descriptive (e.g. 'PERIOD_START')
  custom_period_days   int,                         -- used when measurement_period = CUSTOM_PERIOD
  -- Self-approval VALUE controls (net £)
  max_individual_value numeric(18,2),               -- max net value of a single self-approved P.O (NULL = no cap)
  max_cumulative_value numeric(18,2),               -- max cumulative self-approved value per period (NULL = no cap)
  -- Escalation approvers
  line_manager_email   varchar(160),
  line_manager_name    varchar(160),
  secondary_email      varchar(160),
  secondary_name       varchar(160),
  -- What happens to the count when an approved P.O is later cancelled
  cancelled_po_policy  varchar(20) NOT NULL DEFAULT 'RETAIN_IN_COUNT',  -- RETAIN_IN_COUNT / REMOVE_FROM_COUNT
  -- Governance
  exception_policy     text,
  notes                text,
  effective_from       date,
  effective_to         date,
  active               boolean NOT NULL DEFAULT true,
  updated_by           varchar(160),
  updated_at           timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One policy per department (the settings screen upserts on this).
CREATE UNIQUE INDEX IF NOT EXISTS ux_dept_po_policy_department
  ON governance.dept_po_policy (department);

-- Purchase-order routing + override audit fields.
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS approval_route     varchar(24);  -- SELF_APPROVED / DEPT_SIGNOFF / LINE_MANAGER
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS applied_policy_id  bigint;       -- policy version applied at submit
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS route_original     varchar(24);  -- the route the rules chose, before any override
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS route_override_by  varchar(160);
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS route_override_reason text;
ALTER TABLE finance.purchase_order ADD COLUMN IF NOT EXISTS route_override_at  timestamptz;

COMMIT;
