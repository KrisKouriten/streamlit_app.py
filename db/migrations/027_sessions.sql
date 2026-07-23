-- Migration 027 — server-side sessions (Phase 29, Tier 1 security)
-- Moves session state off the JWT and into the database so sessions can be
-- revoked (logout, logout-everywhere, deactivation) and re-checked against the
-- live account on every request. The JWT becomes a short-lived pointer that
-- carries only a session id (sid); the row below is the source of truth.
-- Additive and idempotent. Safe to re-run.
--
-- ROLLBACK (run only if reverting this migration):
--   DROP TABLE IF EXISTS governance.session;

BEGIN;

CREATE TABLE IF NOT EXISTS governance.session (
  sid           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       integer     NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,                 -- set when the session is killed
  revoked_by    varchar(160),                -- who/what revoked it (email or 'system')
  revoked_reason varchar(60),                -- logout / logout_all / deactivated / expired_swept
  ip            varchar(64),                 -- best-effort client IP at sign-in
  user_agent    text                         -- best-effort user agent at sign-in
);

-- Logout-everywhere and "my active sessions" both scan by user.
CREATE INDEX IF NOT EXISTS ix_session_user ON governance.session (user_id);
-- Sweeping expired/revoked rows.
CREATE INDEX IF NOT EXISTS ix_session_expires ON governance.session (expires_at);

COMMIT;
