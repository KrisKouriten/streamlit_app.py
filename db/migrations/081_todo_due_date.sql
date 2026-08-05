-- 081_todo_due_date.sql
-- A deadline (due date) on personal to-dos, so a task can carry the date it must
-- be completed by and surface as overdue once that date passes. Idempotent.

BEGIN;

ALTER TABLE personal.todo ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS ix_personal_todo_due
  ON personal.todo (user_id, due_date) WHERE due_date IS NOT NULL AND NOT done;

COMMIT;
