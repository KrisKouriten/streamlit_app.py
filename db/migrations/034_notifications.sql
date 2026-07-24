-- Migration 034 — Notification store (Tier 2.3, Collaboration & notifications)
-- A per-user notification feed: "everything that needs you, as it happens".
-- Producers write rows here (first producer: agent outputs entering review);
-- the /inbox page and the top-bar bell read them. Additive and idempotent.
--
-- ROLLBACK: DROP TABLE IF EXISTS governance.notification;

BEGIN;

CREATE TABLE IF NOT EXISTS governance.notification (
  notification_id  bigserial PRIMARY KEY,
  user_id          integer      NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind             varchar(40)  NOT NULL,          -- agent_review | mention | task | system | …
  title            varchar(200) NOT NULL,
  body             text,
  link             varchar(300),                    -- in-app route to open
  actor            varchar(160),                    -- who/what caused it (email or name)
  object_type      varchar(60),
  object_ref       varchar(120),
  read_at          timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The two access paths: a user's unread badge, and their feed newest-first.
CREATE INDEX IF NOT EXISTS notification_user_unread_idx ON governance.notification (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_user_recent_idx ON governance.notification (user_id, created_at DESC);

COMMIT;
