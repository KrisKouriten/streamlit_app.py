-- Migration 104 — Intercompany references: American date → UK date
-- Historic intercompany references embed the transaction date as a 6-digit token
-- in American MMDDYY order (e.g. "…IC 020726" for 07 Feb 26). This rewrites only
-- the tokens that PROVABLY match the row's own transaction date read as MMDDYY,
-- flipping them to UK DDMMYY (…IC 070226). Anything that does not match exactly —
-- an already-UK code, a token with no date meaning, an invalid month — is left
-- untouched. Deterministic and idempotent: once flipped, the MMDDYY token no
-- longer appears, so re-running is a no-op.
--
-- ROLLBACK: no automatic rollback — the original American tokens are not retained.
--   Restore from a backup if the change must be reversed.

BEGIN;

UPDATE finance.intercompany_txn
SET reference = regexp_replace(
      reference,
      '(^|[^0-9])' || to_char(txn_date, 'MMDDYY') || '([^0-9]|$)',
      '\1' || to_char(txn_date, 'DDMMYY') || '\2'
    )
WHERE txn_date IS NOT NULL
  AND reference IS NOT NULL
  -- token must appear bounded by non-digits (so it isn't part of a longer number)
  AND reference ~ ('(^|[^0-9])' || to_char(txn_date, 'MMDDYY') || '([^0-9]|$)')
  -- skip rows where MMDDYY already equals DDMMYY (day = month): nothing to flip
  AND to_char(txn_date, 'MMDDYY') <> to_char(txn_date, 'DDMMYY');

COMMIT;
