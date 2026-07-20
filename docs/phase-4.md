# Phase 4 — Action Centre & Benefits tracker

Delivered 20/07/2026. Scope: one common action register across every source, with
progress, evidence, an activity log, closure approval separate from completion, and a
benefits tracker (opportunity → measurement → validation) split by AI vs human origin.

## Database

`db/migrations/005_action_centre.sql` (idempotent; rollback in header) — extends the
**existing** `intelligence.action_register` (source_type, source_ref, sponsor,
root_cause, progress_pct, dashboard_code, kpi_id, agent_run_id, closure_approved_by/at;
adds CLOSED status), adds `intelligence.action_evidence` and `action_update`, and adds
`intelligence.benefit_opportunity / benefit_measurement / benefit_validation`.
Backfills `source_type` and benefit opportunities for pre-existing actions.

**Status model:** OPEN → IN_PROGRESS → COMPLETE → CLOSED, plus CANCELLED and OVERDUE.
COMPLETE = owner says the work is done; CLOSED = closure **approved** by someone with
the closure right — a separate event, as with tasks (Phase 2) and agent outputs (Phase 3).

**Source taxonomy:** DASHBOARD, MONTH_END, WEEKLY_TASK, AI_AGENT, MANAGEMENT_ACCOUNTS,
BOARD, CONTROL, AUDIT, MANUAL.

## Query layer & API

`lib/action-rules.js` — pure, unit-tested transition rules. `lib/actions.js` — the single
`createAction()` insertion path (used by the API **and** the agent-approval flow, so
agent-raised actions are tagged AI_AGENT, linked to their run, and get a benefit
opportunity), plus transitions, updates, evidence, realised-value recording (writes a
benefit measurement) and benefit validation.

`POST /api/actions`:
- `create { title, ownerName, sponsor?, dueDate?, sourceType?, rootCause?, expectedValue?, ... }` — any signed-in user.
- `start / complete / reopen / cancel` — owner or manager (cancel: manager only), validated by the rules module.
- `close` — **ADMIN / FINANCE / EXEC only** (the closure right); records closure_approved_by/at.
- `update { body, progressPct }`, `evidence { label, url? }`, `record-realised { value }`.
- `validate-benefit { opportunityId, value, decision }` — ADMIN/FINANCE/EXEC only.
Every mutation writes an `action_update` and/or `governance.audit_event`.

## Pages (GOVERN pillar)

| Route | Purpose |
|---|---|
| `/govern/actions` | Filterable register (status/source), summary tiles (open, overdue, awaiting closure, open value), raise-action form |
| `/govern/actions/[id]` | Detail: source, sponsor, root cause, links (KPI/dashboard/agent run/insight), evidence, activity log, manage panel, realised-value capture |
| `/govern/benefits` | Expected vs realised vs validated, split AI vs human; per-opportunity finance validation |

Agent outputs approved in the AI Control Tower with "create action" now flow straight
into this register (source AI_AGENT, linked to the run) — closing the insight→action loop.

## Tests
`tests/actions.test.mjs` — 9 unit tests over the transition rules (owner vs manager vs
closer rights, completion≠closure, terminal states). `npm test`: **30/30** green.

## Acceptance criteria (verified end-to-end on a production-replica DB)
- [x] Migration twice-run clean; existing agent action tagged AI_AGENT; benefit opportunity backfilled.
- [x] Manual action created with expected value → benefit opportunity auto-created.
- [x] Full lifecycle: start → progress note → complete (owner) → **close (separate closure approval)** → realised value recorded → benefit measurement written.
- [x] An OPS-role user is **blocked from closure approval** (and from benefit validation).
- [x] Benefits tracker aggregates expected/realised/validated by AI vs human; finance validation records a benefit_validation and flips the opportunity to VALIDATED.
- [x] Action detail shows closure stamp and the full activity log; `npm test` 30/30; build clean; zero page errors.

## Post-merge step for the owner
Run `db/migrations/005_action_centre.sql` in Neon (safe to re-run). Then: GOVERN →
Action Centre (raise actions; approve agent outputs with "create action" from the AI
Control Tower to see them land here) and GOVERN → Benefits tracker.

## Not in this phase (follow-ups)
- "Raise action" buttons embedded directly on each dashboard/KPI (the source taxonomy
  and API already support it; only the deep-link buttons are outstanding).
- Multi-period benefit measurement charting.
