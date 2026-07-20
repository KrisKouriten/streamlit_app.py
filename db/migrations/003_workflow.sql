-- Migration 003 — Weekly Finance Schedule (Phase 2)
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   DROP SCHEMA IF EXISTS workflow CASCADE;

CREATE SCHEMA IF NOT EXISTS workflow;

-- Recurring task templates: the library the week is generated from.
CREATE TABLE IF NOT EXISTS workflow.task_template (
    template_id     bigserial PRIMARY KEY,
    title           varchar(200) NOT NULL,
    description     text,
    frequency       varchar(20) NOT NULL DEFAULT 'WEEKLY'
                    CHECK (frequency IN ('WEEKLY','MONTHLY','AD_HOC')),
    due_weekday     smallint CHECK (due_weekday BETWEEN 0 AND 6),   -- 0=Mon (WEEKLY)
    due_day         smallint CHECK (due_day BETWEEN 1 AND 31),      -- (MONTHLY)
    priority        varchar(10) NOT NULL DEFAULT 'MEDIUM'
                    CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    est_minutes     integer,
    default_assignee integer REFERENCES public.users(id),
    default_reviewer integer REFERENCES public.users(id),
    entity_id       bigint REFERENCES core.dim_entity(entity_id),
    store_id        bigint REFERENCES core.dim_store(store_id),
    sop_url         varchar(400),
    dashboard_code  varchar(60) REFERENCES intelligence.dashboard_registry(dashboard_code),
    agent_code      varchar(60),            -- FK to agent registry when Phase 3 lands
    requires_review boolean NOT NULL DEFAULT true,
    requires_evidence boolean NOT NULL DEFAULT false,
    is_active       boolean NOT NULL DEFAULT true,
    created_by      varchar(160),
    created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dated task instances. Controlled status set per the design spec.
CREATE TABLE IF NOT EXISTS workflow.task_instance (
    task_id         bigserial PRIMARY KEY,
    template_id     bigint REFERENCES workflow.task_template(template_id),
    title           varchar(200) NOT NULL,
    description     text,
    week_start      date NOT NULL,              -- Monday of the ISO week
    due_date        date NOT NULL,
    priority        varchar(10) NOT NULL DEFAULT 'MEDIUM'
                    CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    status          varchar(30) NOT NULL DEFAULT 'AVAILABLE'
                    CHECK (status IN ('NOT_RELEASED','AVAILABLE','ASSIGNED','IN_PROGRESS',
                                      'WAITING_FOR_INFORMATION','READY_FOR_REVIEW','RETURNED',
                                      'COMPLETE','BLOCKED','OVERDUE','CANCELLED')),
    assigned_to     integer REFERENCES public.users(id),
    reviewer_id     integer REFERENCES public.users(id),
    est_minutes     integer,
    actual_minutes  integer,
    entity_id       bigint REFERENCES core.dim_entity(entity_id),
    store_id        bigint REFERENCES core.dim_store(store_id),
    sop_url         varchar(400),
    dashboard_code  varchar(60) REFERENCES intelligence.dashboard_registry(dashboard_code),
    requires_review boolean NOT NULL DEFAULT true,
    requires_evidence boolean NOT NULL DEFAULT false,
    completed_at    timestamptz,
    approved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, due_date)              -- generation idempotency
);
CREATE INDEX IF NOT EXISTS idx_task_instance_week ON workflow.task_instance(week_start);
CREATE INDEX IF NOT EXISTS idx_task_instance_assignee ON workflow.task_instance(assigned_to, status);

-- Assignment history (current assignee is denormalised on the instance).
CREATE TABLE IF NOT EXISTS workflow.task_assignment (
    assignment_id   bigserial PRIMARY KEY,
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    assigned_to     integer REFERENCES public.users(id),
    assigned_by     varchar(160) NOT NULL,      -- email; 'self' flows use own email
    assignment_type varchar(20) NOT NULL CHECK (assignment_type IN ('DEFAULT','SELF','MANAGER','REASSIGNED','UNASSIGNED')),
    assigned_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow.task_dependency (
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    depends_on      bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id <> depends_on)
);

-- Evidence: links/references (file blobs are a later phase; store where it lives).
CREATE TABLE IF NOT EXISTS workflow.task_evidence (
    evidence_id     bigserial PRIMARY KEY,
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    label           varchar(200) NOT NULL,
    url             varchar(600),
    note            text,
    added_by        varchar(160) NOT NULL,
    added_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow.task_comment (
    comment_id      bigserial PRIMARY KEY,
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    author          varchar(160) NOT NULL,
    body            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reviewer decisions. Completion (assignee) and approval (reviewer) are
-- deliberately separate events.
CREATE TABLE IF NOT EXISTS workflow.task_review (
    review_id       bigserial PRIMARY KEY,
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    reviewer        varchar(160) NOT NULL,
    decision        varchar(10) NOT NULL CHECK (decision IN ('APPROVED','RETURNED')),
    comment         text,
    decided_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Complete status history: one row per transition, written by the API.
CREATE TABLE IF NOT EXISTS workflow.task_status_history (
    history_id      bigserial PRIMARY KEY,
    task_id         bigint NOT NULL REFERENCES workflow.task_instance(task_id),
    from_status     varchar(30),
    to_status       varchar(30) NOT NULL,
    changed_by      varchar(160) NOT NULL,
    note            text,
    changed_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_status_history_task ON workflow.task_status_history(task_id);

CREATE TABLE IF NOT EXISTS workflow.team_capacity (
    user_id         integer PRIMARY KEY REFERENCES public.users(id),
    weekly_hours    numeric(6,2) NOT NULL DEFAULT 37.5,
    notes           varchar(200)
);

-- Default capacity for every current user.
INSERT INTO workflow.team_capacity (user_id)
SELECT id FROM public.users
ON CONFLICT (user_id) DO NOTHING;

-- Seed task templates — a realistic weekly finance rhythm. Owners unset so the
-- team can self-assign or a manager can allocate; edit in the Task Library.
INSERT INTO workflow.task_template
  (title, description, frequency, due_weekday, priority, est_minutes, requires_review, requires_evidence, dashboard_code)
SELECT * FROM (VALUES
  ('Bank reconciliation — weekly',        'Reconcile all bank accounts to the ledger. Attach the rec summary as evidence.', 'WEEKLY', 0, 'CRITICAL', 90,  true,  true,  'CASHFLOW'),
  ('Store sales data load & validation',  'Load the weekly till data, check control totals against the POS report, confirm the refresh log entry.', 'WEEKLY', 0, 'CRITICAL', 60, true, true, 'STORE_SALES_KPI'),
  ('Supplier payment run preparation',    'Prepare the weekly payment run for approval. Evidence: payment run listing.', 'WEEKLY', 1, 'HIGH', 120, true, true, NULL),
  ('Franchise invoicing & statements',    'Raise weekly franchise invoices and issue statements.', 'WEEKLY', 1, 'HIGH', 90, true, false, 'FRANCHISE'),
  ('Cash flow forecast update',           'Roll the 13-week cash forecast forward; note material movements.', 'WEEKLY', 2, 'HIGH', 60, true, false, 'CASHFLOW'),
  ('Store KPI review & commentary',       'Review the store league; note stores needing action in comments.', 'WEEKLY', 2, 'MEDIUM', 45, false, false, 'STORE_SALES_KPI'),
  ('Payroll data submission check',       'Check hours/starters/leavers submitted to payroll are complete.', 'WEEKLY', 3, 'HIGH', 45, true, false, NULL),
  ('Aged receivables review',             'Review franchise and other receivables; chase overdue balances.', 'WEEKLY', 3, 'MEDIUM', 45, false, false, 'FRANCHISE'),
  ('Week-end close checklist',            'Confirm the week''s postings are complete and control accounts are clean.', 'WEEKLY', 4, 'HIGH', 60, true, false, NULL),
  ('VAT control account reconciliation',  'Monthly VAT control rec ahead of the return.', 'MONTHLY', NULL, 'HIGH', 90, true, true, NULL)
) AS v(title, description, frequency, due_weekday, priority, est_minutes, requires_review, requires_evidence, dashboard_code)
WHERE NOT EXISTS (SELECT 1 FROM workflow.task_template);

-- Monthly template due-day for the VAT rec.
UPDATE workflow.task_template SET due_day = 10
WHERE frequency = 'MONTHLY' AND due_day IS NULL;
