# Finance Intelligence Layer — Architecture

_Miniso UK Finance OS. Phase 1 (governed foundation) — the shared layer behind
**Finance Buddy** and **AI Perspective**._

## Principle

One **shared Finance Intelligence Layer** serves both front-ends. There is no
second AI system, and it is **not** a chatbot that sends screen text to a model.
The language model **interprets, explains and recommends** over **governed
Finance OS data** produced by the existing calculation services — it never
invents or redefines a governed figure (EBITDA, gross margin, variance, cash,
rankings all come from the approved services), and it can never post, approve,
release, or send anything.

## Request path (both surfaces)

```
user question / AI-perspective request
  → resolve user + permissions          (permission seam — scopeForSession)
  → build page + filter context         (page-relationship registry)
  → classify question / analysis type
  → select the finance domains
  → retrieve ONLY the governed slices    (existing *-rules calculation services)
  → check data freshness                 (governance.data_refresh_log)
  → [model interprets the facts]
  → validate claims against the facts
  → assign confidence
  → respond with sources (+ optional Create Action)
  → record an auditable run
```

This lives in `lib/intelligence/orchestrator.js`. The deterministic core —
everything except the model call — is `buildEvidencePack()`, which is unit-tested.
`runPerspective()` (structured, page-anchored) and `runBuddy()` (conversational,
open-ended) both run this one path; only how domains are chosen differs.

## Finance Buddy (Phase 2)

The persistent conversational surface. A floating button (`app/finance-buddy.js`),
**⌘/Ctrl-J**, or the "Ask Finance Buddy" command-palette action opens a right-hand
workspace panel. It is pure chrome + a thin client for the endpoint below — it
renders the dialogue, cited sources and honest confidence, and computes nothing.

- **`runBuddy()`** — Buddy has no page, so it selects governed domains from the
  question itself (`domain-select.js`, pure + tested), then runs the shared
  governed path (permissions → retrieve governed facts → confidence → interpret →
  audited run). Prior turns are passed as conversation memory; the model still has
  **no tools** and can take no action. Falls back to the consolidated snapshot when
  a question has no recognisable signal, so there is always a governed anchor.
- **`/api/intelligence/ask`** — `ask` (permission-gated to finance roles, creates
  or continues an owned conversation, records the run + both turns), plus
  `history`, `conversation`, `archive`, and `feedback` actions.
- **Conversation memory** (`conversation.js`, migration 039) — a titled thread of
  user/assistant turns owned by one user; assistant turns link back to the
  governed `ai_run`, so sources / claims / confidence / audit stay in the Phase 1
  record and are never duplicated.

## Modules (Phase 1)

| File | Responsibility |
|---|---|
| `lib/intelligence/permission-rules.js` | **Pure.** The permission seam: what data a session may see. Today unrestricted for finance/admin (matches the app — no row-level security exists yet); the one place per-user scoping slots in later. |
| `lib/intelligence/context-rules.js` | **Pure.** Question classification (7 types) + validation of the controlled page-context object (no raw HTML / browser state). |
| `lib/intelligence/confidence-rules.js` | **Pure.** HIGH/MEDIUM/LOW from freshness + approved-vs-working + missing sources. Never labels a working forecast "approved". |
| `lib/intelligence/source-rules.js` | **Pure.** Citation shaping + a structural guard that every numeric claim maps to a supplied fact. |
| `lib/intelligence/config.js` | Reads `model_configuration` + `prompt_version` — model choice is server-side and swappable. |
| `lib/intelligence/page-context.js` | Reads the page-relationship registry + suggested questions. |
| `lib/intelligence/permission.js` | DB-facing wrapper over the permission seam. |
| `lib/intelligence/retrieval.js` | **The calculation adapter.** Maps each domain to an existing governed service, permission-checked, returning `{ facts, sources }`. Degrades a missing service to a limitation, never a crash. |
| `lib/intelligence/runs.js` | Permanent, auditable run / step / source / claim / feedback records. |
| `lib/intelligence/orchestrator.js` | Ties it together; `runPerspective()` is ready for the Phase 3 UI. |
| `lib/llm.js` | `generateGoverned()` added — config-driven model id + structured JSON output; single fetch, no tools (same lean, no-SDK design as the existing `generateText`). |

## AI Perspective (Phase 3)

The page-anchored surface. An **✦ AI Perspective** button sits on each of the six
governed pages (`app/perspective-panel.js`) and passes its **pageContext** —
`pageId` + the page's current filters — to the endpoint. No new schema: it runs
entirely on the Phase 1 seeds and `runPerspective()`.

- **`/api/intelligence/perspective`** — `perspective` (finance-role gated;
  validates `pageId` against the code-side manifest, then runs the governed
  `runPerspective` path and returns the structured perspective + sources +
  confidence + claim-verification), plus `suggestions` (per-page prompts),
  `create-action`, and `feedback`.
- **Structured output** rendered from the seeded `PERSPECTIVE_V1` schema:
  executive summary, facts, drivers, connected context, risks, opportunities,
  recommended actions, financial effects, data quality, confidence + sources.
- **Create Action** turns a recommendation into a governed `action_register`
  entry (`sourceType: AI_PERSPECTIVE`), reusing the existing actions layer —
  the model still only drafts; a person creates and owns the action.
- **The six pages** and their `pageContext` are listed in
  `lib/intelligence/perspective-pages.js` — a pure manifest kept in step with the
  migration 038 registry (unit-tested against the seed).

## Data model (migration 038, `intelligence.*`)

- `model_configuration` — model/effort/max_tokens/prompt per use-case (ROUTING → Haiku 4.5, PERSPECTIVE → Sonnet 5, BUDDY → Opus 5; **all swappable without a deploy**).
- `prompt_version` — versioned system prompts + the AI-Perspective output schema.
- `page_context_registry` + `page_relationship` — the governed page→domains map (CR §4.4), config not code. Seeded for the six Phase-3 pages.
- `suggested_question` — per-page prompts (CR §13).
- `ai_run` / `ai_run_step` / `ai_source` / `ai_claim` / `ai_feedback` — the auditable interactive-run record and traceability.

Outputs **reuse** the existing sinks — `intelligence.ai_insight`, `action_register`, `benefit_*` — rather than duplicating them. Audit goes through the shared `governance.audit_event`.

## Governance guardrails

- **Permissions first, server-side.** Scope is resolved before any retrieval; a session without a finance grant gets an honest limitation, not data. A cross-store/entity ranking is withheld unless the scope permits the comparison (CR §9).
  - _Current reality:_ the platform has no row-level security, so every finance/admin user already sees all 26 entities and all stores. The AI is deliberately given exactly that visibility and no more. Per-user entity/store/region scoping is a separate future project; when built, only `permission-rules.js` / `permission.js` change.
- **No invented figures.** The model receives governed facts and is instructed to use only those; `validateClaims` is a structural backstop; material outputs are human-reviewed.
- **No autonomous actions.** The model can draft/recommend only. Anything addressed to the Board, investors, or the listed parent group is explicitly a draft requiring human sign-off (house listing-rules sensitivity).
- **Honest confidence & freshness** on every response; failures and stale/missing data are surfaced, never hidden (CR §8, §19).
- **Every run is permanently auditable** (`intelligence.ai_run` + `governance.audit_event`).

## Model & cost

Tiered and swappable via `model_configuration`: Haiku 4.5 for cheap routing,
Sonnet 5 as the AI-Perspective workhorse, Opus 5 for deep Buddy reasoning.
Structured outputs + retrieving only the relevant governed slices keep tokens
down; later phases add caching keyed on page + filters + data-version +
permissions + prompt-version, with manual refresh and no cross-permission reuse.

## Deployment

- Run migrations **038** (foundation), **039** (Buddy conversation memory) and **040** (Phase-4 page registry seeds) — all idempotent — on the Neon DB. **Phase 3 (AI Perspective) adds no migration** — it runs on the 038 seeds; **Phase 4** adds only the 040 registry seeds (no new tables, no new calculations).
- `ANTHROPIC_API_KEY` is already set (the existing `TRADING_COMMENTARY` agent uses it).
- Phase 1 adds **no UI and makes no live model calls in any user path** — it is the foundation. Phase 2 (Finance Buddy) is the first surface that makes a live governed model call, only when a finance user asks. AI Perspective on the six seeded pages (Phase 3) builds on the same layer.

## Roadmap

1. **Foundation** ✅ — config, audit, permission-aware retrieval, source + confidence, page registry, orchestrator.
2. **Finance Buddy MVP** ✅ — persistent button (⌘/Ctrl-J) + palette action, panel/workspace, `/api/intelligence/ask`, `runBuddy()`, conversation memory (migration 039), sources & confidence.
3. **AI Perspective MVP** ✅ — ✦ button + `pageContext` on the six seeded pages, `/api/intelligence/perspective`, structured output, sources/confidence, Create Action. **No new migration** — runs on the Phase 1 seeds.
4. **Wider module coverage** ✅ (Trading & commercial, Position & close, Planning) — seven more governed domains in `retrieval.js` (procurement, SKU, three-statement, close status, intercompany, scenarios, business projects), Buddy routing for each (`domain-select.js`), and AI Perspective on seven more pages (migration **040** registry seeds). Remaining dashboards (franchise, fixed assets, budget & forecast) not yet covered.
5. **Advanced** — proactive briefings, drafted commentary, benefit measurement.
