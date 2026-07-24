# Phase 33 — Close automation: the Close Cockpit (Tier 3.1)

**Tier 3, item 1 ("Leapfrog").** Turns month-end close from a manual checklist
into an engine. A period's close is a tracked run whose machine-checkable gates
go green **on their own** from the data already in the platform; only genuinely
human judgements wait on a person, and a person is the only one who locks the
period.

## The idea

The design principle: a step the system can *prove* from data is **AUTO** — it
evaluates itself, nobody ticks a box. Only human judgements (variance sign-off,
board pack issued) are **MANUAL** and wait on a person. Anyone with rights can
also **override** any step — waive it (N/A), force it done, or mark it blocked —
and the override always wins over the automatic reading, with who and when
recorded.

## What it does

- New **`/operate/close`** — the **Close Cockpit**. A readiness ring + score, a
  period selector, the outstanding-blockers list, and the five stages of the
  close (Data & feeds → Pre-close integrity → Workstream sign-off → Review &
  commentary → Lock & report) with each step's live status. Managers get
  sign-off / waive / clear controls and the **Lock** control (enabled only when
  every gate is satisfied), plus **Reopen** for a locked period.
- The **AUTO gates**, all read-only from existing data:
  - *Actuals loaded* for the period (`finance.fact_financials`).
  - *Feeds fresh* within the 9-day tolerance (`governance.data_refresh_log`).
  - *No unresolved high-severity pre-close exceptions* and *every exception
    dispositioned* (reuses the Phase 10 `getPreclose` engine + review log).
  - *Workstream playbook complete* — P&L / Accruals / Fixed-assets
    (`finance.ma_close_action_state`).
  - *Month-end tasks complete* for the period (`workflow.task_instance`).
  - *Trading commentary drafted* (the Tier 2.2 agent's output for the period).
- New **`CLOSE_STATUS`** agent (rule-based, registered by migration 035). It
  evaluates the same plan and emits one status REPORT — read-only, non-material
  so it closes automatically and is recorded in the run history. Runnable on a
  schedule via **`/api/close/cron`** (weekday 07:00, `vercel.json`), guarded by
  `CRON_SECRET`, so readiness is evaluated without anyone asking. The agent
  never locks a period or ticks a step — the Close Cockpit is where a person
  does that.

## Shape

- `lib/close-plan-rules.js` — **pure**: `CLOSE_STAGES`, `CLOSE_STEPS`,
  `evaluateStep`, `evaluatePlan` (per-step status → per-stage rollup →
  readiness/score/blockers), `readinessLabel`. Unit-tested in
  `tests/close-plan.test.mjs` (9 tests, incl. overrides, waivers, NA and lock).
- `lib/close.js` — **server**: `getSignals` (gathers the six read-only signals),
  run state (`openCloseRun` / `lockClose` / `reopenClose` / `setStepOverride`),
  `getCloseBoard`. Everything degrades cleanly if migration 035 (or 012) is
  absent (Postgres 42P01) — the gates just read as unconfigured.
- `db/migrations/035_close_orchestration.sql` — `close.close_run` +
  `close.close_step_override`; registers the `CLOSE_STATUS` agent
  (registry + version + performance).
- `lib/agents.js` — `IMPLEMENTATIONS.CLOSE_STATUS`.
- `lib/agent-rules.js` — `AGENT_DASHBOARD.CLOSE_STATUS`.
- `app/api/close/route.js` — `GET` board, `POST` open / override / lock / reopen
  (ADMIN/FINANCE for writes).
- `app/api/close/cron/route.js` — scheduled + manual close-agent run.
- `app/operate/close/{page,close-ui}.js` — the Close Cockpit.
- `lib/nav-registry.js` — **Close Cockpit** added to Operate.
- `vercel.json` — weekday cron for `/api/close/cron`.

## What is persisted vs computed

Nothing is stored for the AUTO gates — they are evaluated on every load from the
live data, so they can never drift out of sync. Only the human dispositions are
persisted: the run's lifecycle (`open → locked → reopened`) and per-step
overrides (sign-off / waiver / block, with actor + timestamp).

## Migration to run at merge

- **035** — creates the `close` schema (`close_run`, `close_step_override`) and
  registers the `CLOSE_STATUS` agent. Idempotent. Until it is applied, the Close
  Cockpit still renders (run state reads as "open", overrides empty) and the
  cron's agent run reports "unknown agent" harmlessly.

## Not yet included (fast-follow)

- Scheduled **notifications** when a period is not ready as the target working
  day approaches (today the scheduled agent records readiness; it does not ping).
- Auto-generating the month-end task set from a close template when a run opens.
- A close calendar / target-day model (working-day offsets per stage).
