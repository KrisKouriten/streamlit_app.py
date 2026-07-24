# Phase 31 — LLM commentary agent (Tier 2.2)

**Tier 2, item 2 of 3 ("Match the best").** The first **LLM** agent in the Agent
Centre: it drafts a weekly management commentary on company-owned store trading
and routes it through the existing human-review flow.

## What it does

- New governed agent **`TRADING_COMMENTARY`** (registered by migration 033,
  `runner_type = 'LLM'`, `approval_required = true`).
- On a run it: (1) gathers the governed company-store YTD net-sales/footfall
  figures vs last year **read-only**; (2) asks Claude (`claude-opus-4-8`) to
  write 2–4 short paragraphs using **only** those figures; (3) returns one
  narrative INSIGHT that lands in **PENDING_REVIEW**.
- Run in the Agent Centre (**AI → Agents → Run**) or reviewed in the agent
  review queue — the same screens and API as the rule agents; no new surfaces.

## Guardrails (why this is safe to ship)

The roadmap flagged the risk: hallucinated commentary reaching decision-makers.
The controls are structural, not just prompt text:

- **No tools, no data access for the model.** The model receives a system +
  user prompt and nothing else (`lib/llm.js` sends no `tools`). It cannot query,
  browse, or write — it only turns supplied numbers into prose.
- **Read-only data gathering.** Figures are gathered by the runner through the
  same `selectOnly` helper as every agent (SELECT-only; all writes go to
  `agent.*`).
- **Always human-reviewed.** `approval_required = true` → every draft is
  `PENDING_REVIEW`; nothing reaches `intelligence.ai_insight` until a human
  approves or amends it (existing review flow in `app/api/agents`).
- **Full run records.** Plan, each step, the output, token usage, and any
  failure are written to `agent.agent_run` / `agent_run_step` / `agent_output` /
  `agent_exception` — the same audit trail as the rule agents.
- **Prompt fences fabrication.** `COMMENTARY_SYSTEM` bars inventing numbers or
  opining outside store trading; the figures are the only source (tested).
- **Safety refusal handled.** A `stop_reason: "refusal"` from Claude surfaces as
  a recorded run failure, not a silent empty output.

## Config

- Needs **`ANTHROPIC_API_KEY`** (Vercel env var, Sensitive, all environments).
  Without it the agent run fails cleanly with a clear message —
  `anthropicConfigured()` gates it, so the rest of the app is unaffected.
- Optional **`ANTHROPIC_MODEL`** overrides the model (default `claude-opus-4-8`).
- The key lives only in the environment; it is never logged, returned, or
  committed.

## Files

- `lib/llm-rules.js` — **pure**: `COMMENTARY_SYSTEM`, `buildCommentaryPrompt`
  (figures → {system, user}); unit-tested in `tests/llm-rules.test.mjs`.
- `lib/llm.js` — **server**: `anthropicConfigured()`, `generateText()` (one
  non-streaming Messages call via `fetch`, no SDK dependency).
- `lib/agents.js` — `IMPLEMENTATIONS.TRADING_COMMENTARY` (gather → draft → one
  INSIGHT).
- `lib/agent-rules.js` — `AGENT_DASHBOARD.TRADING_COMMENTARY` (approved insights
  land on the MASTER hub).
- `db/migrations/033_trading_commentary_agent.sql` — registry + version +
  performance rows.
- `app/api/agents/route.js` — `maxDuration = 60` for the Claude call.

## Not yet included (fast-follow)

- Scheduled runs (the `SCHEDULED_RUNS` control is off — trigger is manual for
  now, by design).
- Further LLM agents (variance narrative, board-pack summary) reuse this exact
  pattern — add a registry row + an `IMPLEMENTATIONS` entry.
