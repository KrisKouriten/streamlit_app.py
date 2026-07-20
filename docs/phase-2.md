# Phase 2 — Weekly Finance Schedule

Delivered 20/07/2026. Scope: recurring task templates, dated task instances with the
11 controlled statuses, assignment (default/self/manager/reassign), dependencies,
evidence, comments, reviewer approval distinct from completion, overdue escalation,
team workload view, review queue, task library, week completion stats.

## Database

`db/migrations/003_workflow.sql` (idempotent; rollback = `DROP SCHEMA workflow CASCADE`):
`workflow.task_template`, `task_instance`, `task_assignment`, `task_dependency`,
`task_evidence`, `task_comment`, `task_review`, `task_status_history`, `team_capacity`.
Seeds 10 realistic weekly/monthly finance templates and default 37.5h capacity per user.
`task_comment` is an addition to the instructed table list (comments needed a home).

**Statuses:** NOT_RELEASED, AVAILABLE, ASSIGNED, IN_PROGRESS, WAITING_FOR_INFORMATION,
READY_FOR_REVIEW, RETURNED, COMPLETE, BLOCKED, OVERDUE, CANCELLED.

**Design decisions:** current assignee denormalised on the instance with full history in
`task_assignment`; OVERDUE applied by an escalation pass (runs on schedule/my-week views
and on generation) with a history row; evidence is link/reference-based (file blobs are a
later phase); generation idempotency via `UNIQUE (template_id, due_date)`.

## Pages (PERFORM pillar)

| Route | Purpose |
|---|---|
| `/perform/my-week` | My tasks by day + unassigned pool I can take; week stats; state-appropriate action buttons |
| `/perform/tasks/[id]` | Full task detail: fields, SOP/dashboard links, dependencies, evidence, comments, reviewer panel, complete status history |
| `/perform/schedule` | Team view: generate week (manager), unassigned pool with allocation, per-person workload vs capacity, completion bar |
| `/perform/review` | Review queue — approve/return with comment; own submissions hidden |
| `/perform/library` | Recurring templates (read-only this phase; editing is a follow-up) |

## API contract — `POST /api/workflow/tasks`

Body `{ action, taskId?, ... }`. Actions:
- `generate-week { weekStart }` — manager only; creates instances from active templates (idempotent), escalates overdue.
- `assign { taskId, userId|null }` — self-assign (only if unassigned), manager allocate/reassign/unassign; blocked for COMPLETE/CANCELLED/READY_FOR_REVIEW.
- Transitions: `release, start, wait, resume, block, submit, complete, approve, return, cancel` — validated by `lib/workflow-rules.js` (pure, unit-tested):
  - assignee (or manager) works the task; only reviewer/manager approves; **never own submissions**;
  - `complete` only allowed when the task doesn't require review — otherwise `submit`;
  - `start` blocked while dependencies are not COMPLETE;
  - `submit`/`complete` blocked until evidence is attached when the task requires it;
  - `cancel`/`release` manager-only.
- `comment { body }`, `evidence { label, url?, note? }`, `log-time { actualMinutes }`.

Every transition writes `task_status_history`; reviews write `task_review` (+`approved_at`);
assignments write `task_assignment`; all mutations write `governance.audit_event`.
Errors are 400 with a human-readable reason; 401/403 for auth.

## Permissions

| Capability | Who |
|---|---|
| Generate week, allocate/reassign, cancel, act on anyone's task | ADMIN, FINANCE |
| Take unassigned tasks, work own tasks, comment, attach evidence | any signed-in role |
| Approve/return | named reviewer or ADMIN/FINANCE — never the submitter |

## Tests

`tests/workflow.test.mjs` — 10 unit tests over the pure transition rules
(who-may-do-what, review separation, self-approval block, status-set integrity).
`npm test`: 14/14 green.

## Acceptance criteria (verified end-to-end on a production-replica DB, two users)

- [x] Migration runs twice cleanly; 10 templates seeded.
- [x] Generate week creates 9 dated tasks; re-generation creates 0 (idempotent).
- [x] Self-assign, manager allocation and reassignment all work; users created after
      the migration appear in allocation lists (capacity defaulted).
- [x] Evidence gate blocks submission until evidence attached.
- [x] Completion and approval are separate: submitter blocked from approving own task
      (even managers); reviewer approval → COMPLETE with recorded decision.
- [x] Status history shows every step incl. generation and automatic overdue escalation.
- [x] Week completion %, workload vs capacity, review queue and library all render; zero page errors.

## Operational notes

- Generate each week from the Team schedule page (manager). A scheduled auto-generate
  (Vercel cron) is a planned follow-up alongside template editing in the library.
- The month-end close tracker continues unchanged; its migration into workflow
  templates remains a separately-approved later step.
