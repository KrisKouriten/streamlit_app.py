-- Migration 001 — roles, permissions, audit trail (Phase 1)
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK (run only if reverting this migration):
--   DROP TABLE IF EXISTS governance.user_role, governance.permission, governance.role CASCADE;
--   DROP TABLE IF EXISTS governance.audit_event;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS is_active;

-- 1. Roles (identity stays in public.users — extend, don't duplicate)
CREATE TABLE IF NOT EXISTS governance.role (
    role_code       varchar(20) PRIMARY KEY,
    role_name       varchar(80) NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS governance.permission (
    permission_code varchar(40) PRIMARY KEY,
    description     text NOT NULL
);

CREATE TABLE IF NOT EXISTS governance.role_permission (
    role_code       varchar(20) NOT NULL REFERENCES governance.role(role_code),
    permission_code varchar(40) NOT NULL REFERENCES governance.permission(permission_code),
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS governance.user_role (
    user_id         integer NOT NULL REFERENCES public.users(id),
    role_code       varchar(20) NOT NULL REFERENCES governance.role(role_code),
    granted_by      varchar(120),
    granted_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_code)
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Seed roles and permissions
INSERT INTO governance.role (role_code, role_name, description) VALUES
('ADMIN',      'Administrator',      'Full access including user management and governance settings'),
('EXEC',       'Executive',          'All dashboards and reports; no admin functions'),
('FINANCE',    'Finance team',       'All finance dashboards, tasks and reviews'),
('OPS',        'Operations',         'Operational dashboards (stores, inventory)'),
('FRANCHISEE', 'Franchise partner',  'Own-store data only (store scoping enforced in queries)')
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO governance.permission (permission_code, description) VALUES
('users.manage',      'Create users, assign roles, reset passwords'),
('tasks.review',      'Approve or return submitted tasks'),
('agents.run',        'Trigger agent runs manually'),
('agents.review',     'Approve, amend or reject agent outputs'),
('actions.close',     'Approve closure of actions'),
('definitions.edit',  'Edit governed KPI definitions')
ON CONFLICT (permission_code) DO NOTHING;

INSERT INTO governance.role_permission (role_code, permission_code) VALUES
('ADMIN','users.manage'), ('ADMIN','tasks.review'), ('ADMIN','agents.run'),
('ADMIN','agents.review'), ('ADMIN','actions.close'), ('ADMIN','definitions.edit'),
('FINANCE','tasks.review'), ('FINANCE','agents.run'), ('FINANCE','agents.review'),
('FINANCE','actions.close'),
('EXEC','actions.close')
ON CONFLICT DO NOTHING;

-- 3. Default role assignments for existing users:
--    kris@kouriten.com -> ADMIN; every other active user -> FINANCE.
INSERT INTO governance.user_role (user_id, role_code, granted_by)
SELECT id, 'ADMIN', 'migration 001'
FROM public.users WHERE lower(email) = 'kris@kouriten.com'
ON CONFLICT DO NOTHING;

INSERT INTO governance.user_role (user_id, role_code, granted_by)
SELECT u.id, 'FINANCE', 'migration 001'
FROM public.users u
WHERE NOT EXISTS (SELECT 1 FROM governance.user_role r WHERE r.user_id = u.id)
ON CONFLICT DO NOTHING;

-- 4. Audit trail — one row per state-changing action, written by the app
CREATE TABLE IF NOT EXISTS governance.audit_event (
    audit_id        bigserial PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_email     varchar(160),
    actor_name      varchar(120),
    event_type      varchar(60) NOT NULL,        -- e.g. auth.login, task.toggle, user.create
    object_type     varchar(60),                 -- e.g. task_state, users
    object_ref      varchar(200),                -- key of the object affected
    detail          jsonb                        -- before/after or parameters (no secrets)
);
CREATE INDEX IF NOT EXISTS idx_audit_event_time ON governance.audit_event(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON governance.audit_event(event_type);
