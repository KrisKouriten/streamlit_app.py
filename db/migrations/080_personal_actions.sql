-- 080_personal_actions.sql
-- "My Actions & Notes" on Home — strictly private to the signed-in user. Notes
-- (free-form duties / reminders) and a personal to-do list that can be checked
-- off. Every row is owned by a user_id; the app only ever reads/writes rows for
-- the current session's user, and this data is never surfaced anywhere else.
-- Idempotent; safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS personal;

CREATE TABLE IF NOT EXISTS personal.note (
  note_id     bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_personal_note_user ON personal.note (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal.todo (
  todo_id     bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_personal_todo_user ON personal.todo (user_id, done, created_at DESC);

COMMIT;
