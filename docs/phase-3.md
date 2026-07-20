# Phase 3 — Finance Agent Control Centre

Delivered 20/07/2026. Scope: governed agent registry with versioning, permanent run
records, the 8-state output lifecycle with human review, exception tracking,
performance rollups, and the first two production rule agents.

## Database

`db/migrations/004_agents.sql` (idempotent; rollback in header): `agent.agent_registry`,
`agent_version`, `agent_prompt`, `agent_control`, `agent_run`, `agent_run_step`,
`agent_output`, `agent_exception`, `agent_review`, `agent_performance`; linkage columns
on `intelligence.ai_insight` (`agent_run_id`, `agent_output_id`).

**Output lifecycle:** GENERATED → AUTOMATED_VALIDATION → PENDING_REVIEW →
APPROVED / AMENDED / REJECTED → ACTION_CREATED → CLOSED. Structurally-failed outputs
stop at AUTOMATED_VALIDATION; everything else requiring approval waits at
PENDING_REVIEW until a human decides.

**Guardrails (structural, not prompt-based):**
- Agent implementations receive a SELECT-only query helper; any non-SELECT throws.
- The runner writes only to `agent.*`; insights/actions are created by the *review*
  endpoint after a human decision — never by the agent.
- Journal posting, payment release, forecast mutation and external communication have
  no code path at all; `agent.agent_control` documents these as permanently-disabled
  switches so their state is visible in governance reviews.
- `SCHEDULED_RUNS` control is off: every run is human-triggered until a schedule is
  approved.

## Seeded agents

| Agent | Type | Risk | What it does |
|---|---|---|---|
| `STORE_PRIORITIES` | RULE | MEDIUM | Scans every comparable store's YTD vs LY on the governed KPI definitions; flags sales < −10%, footfall < −10%, conversion < −5%, returns > +25%, below break-even; ranks by annualised impact, keeps top 10; materiality £25k |
| `DATA_QUALITY` | RULE | LOW | Load freshness vs 9-day tolerance; zero-footfall share of trading days; invalid-day exclusions; overdue critical tasks. Clean pass emits a REPORT |

Each has the full governed contract on its registry row (purpose, owner, reviewer,
inputs, data sources, instructions, KPI definitions, materiality, outputs, exclusions,
approval requirements, escalation rules, data permissions, version, risk rating).

## Pages (AI CONTROL TOWER pillar)

| Route | Purpose |
|---|---|
| `/ai` | Agent Centre: agent tiles (owner, reviewer, risk, last run, pending reviews, Run now), performance table, open exceptions |
| `/ai/agents/[code]` | Agent profile: full governed definition, run history, version history |
| `/ai/runs/[id]` | Run detail: trigger, period, data freshness, plan, step-by-step record, exceptions, outputs with inline review panel |
| `/ai/review` | Cross-agent output review queue |

## API contract — `POST /api/agents`

- `run { agentCode }` — ADMIN/FINANCE only. Creates the permanent run record
  (freshness stamp from the refresh log, plan, steps with timings), validates each
  output, sets lifecycle, updates performance. Failures produce a FAILED run + exception.
- `approve / amend / reject { outputId, comment, amendedHeadline?, amendedBody?, createAction?, actionOwner? }`
  — ADMIN/FINANCE only; validated by `lib/agent-rules.js` (pure, unit-tested).
  Approve/amend create an `intelligence.ai_insight` (APPROVED/AMENDED, reviewer stamped,
  run/output linked; amended text wins); `createAction` also creates an
  `intelligence.action_register` row and moves the output to ACTION_CREATED.
  Reject requires a comment convention (UI-enforced) and creates nothing.
- `close { outputId }` — decided outputs → CLOSED.
All decisions write `agent.agent_review` + `governance.audit_event`.

## Tests

`tests/agents.test.mjs` — 7 unit tests over decision rules and automated validation.
`npm test`: 21/21 green.

## Acceptance criteria (verified end-to-end on a production-replica DB)

- [x] Migration twice-run clean; both agents + 5 disabled controls seeded.
- [x] Both agents run against real data: Store Priorities produced 10 ranked insights
      (all material, PENDING_REVIEW); Data Quality flagged footfall coverage 10.3%.
- [x] Run detail shows plan, freshness, timed steps and outputs with lifecycle chips.
- [x] Approve → insight + action created (lifecycle ACTION_CREATED); amend → amended
      text flows into the insight; reject → REJECTED → CLOSED; re-deciding blocked.
- [x] Performance rollups correct after runs and reviews; audit events written.
- [x] `npm test` 21/21; build clean; zero page errors.

## Not in this phase (follow-ups)

- LLM agent (weekly trading commentary via the Claude API) — needs an API key in
  Vercel env; the registry/prompt/version plumbing is ready for it.
- Scheduled runs (control exists, off); registry editing UI (edits via DB create
  version rows); exception resolution workflow beyond viewing.
