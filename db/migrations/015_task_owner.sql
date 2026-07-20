-- Migration 015 — month-end close: finance owner per task (Phase 13)
-- Each entity close task carries an assignable finance owner, separate from
-- who ticked it done. Additive and idempotent. Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE public.task_state DROP COLUMN IF EXISTS owner;

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_state (
  period   text NOT NULL,
  task_key text NOT NULL,
  done     boolean NOT NULL DEFAULT false,
  done_by  text,
  done_at  timestamptz,
  PRIMARY KEY (period, task_key)
);

ALTER TABLE public.task_state ADD COLUMN IF NOT EXISTS owner varchar(120);

COMMIT;
