-- Migration 030 — login throttle (Phase 29, Tier 1 item 4)
-- Brakes password brute-force at sign-in: failures per email are counted in a
-- rolling window and the account's sign-in locks briefly once the threshold is
-- hit. A successful sign-in clears the row. (The MFA step has its own lockout.)
-- Additive and idempotent.
--
-- ROLLBACK: DROP TABLE IF EXISTS governance.login_attempt;

BEGIN;

CREATE TABLE IF NOT EXISTS governance.login_attempt (
  identifier        varchar(160) PRIMARY KEY,   -- lowercased email
  attempts          integer      NOT NULL DEFAULT 0,
  first_attempt_at  timestamptz,
  last_attempt_at   timestamptz,
  locked_until      timestamptz
);

COMMIT;
