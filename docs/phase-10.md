# Phase 10 — Management accounts close (OPERATE)

The month-end reconciliation playbook from *Management Accounts — Month-End
Workings & Process*, live at `/operate/management-close`. Two halves: pre-close
checks that interrogate the real accounts before sign-off, and the close-action
playbook per period.

## Pre-close checks (the exception report)
Runs the latest loaded Xero actuals against a **reference model** of nominal
expectations and surfaces only what needs a person:

- **Check A · Completeness** — expected nominals with no posting (flagged as
  accrual candidates), and postings with no home in the model.
- **Check B · Variable drift** — variable nominals re-derived from the revenue
  driver (% of revenue) and compared to actuals with £/% gaps.
- **Check C · Fixed drift** — fixed nominals line-by-line against the schedule;
  under-postings hint an accrual top-up, over-postings a timing/misposting.
- **Sign consistency** — cost accounts in credit / revenue in debit.

Every exception carries the **confirm · correct · explain** cycle
(`finance.preclose_review`, audited, actor + note on file); clean lines are
counted as assured. A **"period covers N months"** control scales monthly
expectations to cumulative loads (the current Cambridge load is H1 = 6 months).

## The reference model
`finance.nominal_expectation` — behaviour (REVENUE / VARIABLE / FIXED), monthly
amount or % of revenue, £ and % tolerances, expected-every-period. Seeded as a
clearly-labelled **baseline from the Cambridge H1 run-rate**; finance replaces it
wholesale with the maintained schedule via CSV upload (template provided) —
source then reads `SCHEDULE · uploaded by finance`.

## Close actions (the playbook)
The 18 assurance steps from the process master checklist, per period, across
three workstreams — 01 P&L actuals, 02 Accruals & prepayments, 03 Fixed assets —
checkable with actor + timestamp (`ma_close_action` / `ma_close_action_state`).
Workstream 04 (inventory roll-forward) is shown as *next to build*, per the
process. Deliberately **not duplicated**: WORKFLOW → Month-end close keeps the
per-entity execution ticks ("Accruals posted", "Depreciation run"); this screen
holds the reconciliation/assurance steps.

## Build
- Migration `012_management_close.sql` (idempotent; baseline seeds only when
  Xero actuals exist and no active model is present).
- `lib/preclose-rules.js` — pure engine, 7 new tests (52/52 suite green).
- `lib/preclose.js` + `/api/management-close` (ADMIN/FINANCE writes, audited).
- OPERATE hub card, ⌘K palette entry, SOP/handbook updated.

## Verification
Browser-verified on the real Cambridge load: months=6 reconciles clean
("all lines assured"); months=1 correctly flags fixed drift with hints; a
review sticks (Confirmed chip, DB row with actor); playbook ticks persist and
untick. Build clean.
