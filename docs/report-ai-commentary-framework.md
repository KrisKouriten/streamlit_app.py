# Report AI Commentary Framework

_Miniso UK Finance OS. Governed, section-level AI commentary for reports —
`lib/reporting/report-commentary.js` and `lib/reporting/commentary-perspectives.js`
(CR §10–§12, §28)._

## Principle

The model drafts a section's narrative over **only** the governed figures already
resolved for that section — the same numbers the page shows, so the commentary
reconciles to source. It interprets, never computes; it takes no action; and it
lands as a **DRAFT** that a human must review and approve before it can enter an
issued report. Every draft is an auditable intelligence run. This reuses the
governed Finance Intelligence Layer end-to-end — there is no second AI system.

## The ten perspectives (CR §10)

A perspective is a controlled *lens*; the governance system prompt is shared. Each
carries a `label`, an `audience` and a `focus` list woven into the user message.

| Key | Label | Focus (abridged) |
|---|---|---|
| `EXECUTIVE` | Executive | material performance, drivers, risks, opportunities, decisions, EBITDA & cash effect |
| `FINANCE_DIRECTOR` | Finance Director | revenue, gross margin, EBITDA, cash, working capital, forecast confidence, controls |
| `FPA` | FP&A | budget/forecast variance, prior-forecast movement, run rate, assumptions, sensitivities, scenarios |
| `COMMERCIAL_FINANCE` | Commercial Finance | price, volume, mix, store/product performance, margin, inventory, promotions |
| `FINANCIAL_CONTROLLER` | Financial Controller | actuals, nominal movements, accruals, reconciliations, close status, control exceptions |
| `CASH_TREASURY` | Cash and Treasury | cash movement, facility headroom, receivables/payables, capex, tax, lowest cash point |
| `OPERATIONAL` | Operational | store execution, staffing, availability, projects, purchase orders, delivery risks |
| `RISK` | Risk | downside exposure, control failures, data quality, cash pressure, credit, inventory ageing |
| `OPPORTUNITY` | Opportunity | revenue recovery, margin, cost reduction, working capital, pricing, cash acceleration |
| `ACTION` | Action-oriented | what needs to happen, owner, priority, due date, expected value, required decision |

`isPerspective(key)` guards the list; an unknown perspective falls back to
`EXECUTIVE`.

## Detail, tone, comparison and include settings

- **Detail levels** (`DETAIL_LEVELS`): `HEADLINE`, `CONCISE`, `STANDARD`,
  `DETAILED`, `TECHNICAL`.
- **Tones** (`TONES`): `BOARD`, `EXECUTIVE`, `MANAGEMENT`, `OPERATIONAL`,
  `TECHNICAL`, `EXTERNAL`.
- **Comparison basis** comes from the report's `comparator`
  (`LATEST_FORECAST`, `BUDGET`, `PRIOR_YEAR`, …).
- **Output include-flags** (`OUTPUT_OPTIONS`): `drivers`, `risks`,
  `opportunities`, `recommended_actions`, `financial_effect`,
  `decisions_required`, `data_limitations`, `confidence`, `source_footnotes`.
  `defaultIncludeFor(detailLevel)` scales the fuller sections up with detail —
  `HEADLINE` asks only for drivers; `STANDARD` and above request the full set.

The builder exposes perspective and detail directly; tone defaults to
`MANAGEMENT`.

## The report-context object (CR §28)

`buildReportContext(...)` builds a **metadata + controlled-settings** object —
never raw data. The governed FACTS are assembled and appended separately by the
service, so raw data never reaches the context builder. Shape:

```
{
  report_id, template, reporting_period, data_through_date, audience,
  section, page,
  scope: { entities, stores, departments, franchises },
  comparison_basis,          // the report comparator
  commentary_type,           // the perspective (validated; EXECUTIVE fallback)
  detail_level,              // validated; STANDARD fallback
  tone,                      // validated; MANAGEMENT fallback
  include                    // include-flags (explicit, or default for the level)
}
```

`renderContextPreamble(ctx, focusHint)` turns this into a deterministic plain-text
preamble; `buildUser` in `report-commentary.js` then appends the **GOVERNED
FACTS** block (only KPIs with values) plus any **DATA LIMITATIONS** from the
envelope warnings.

## Reuse of the governed Intelligence Layer

`generateReportCommentary` runs the same governed path as Finance Buddy, AI
Perspective and Phase-5b commentary:

1. Resolve the section and its governed envelope via `resolveSource`
   (`scopeForSession(actor)` first — permissions before data).
2. Build the report context; read the swappable `REPORT_COMMENTARY` model config
   and `REPORT_COMMENTARY_V1` prompt (`getModelConfig` / `getPrompt`).
3. Open an auditable run (`openRun`, surface `REPORT_COMMENTARY`), record the
   evidence step and sources (`recordStep`, `recordSources`), assess honest
   confidence (`assessConfidence`, which never labels a working forecast
   "approved").
4. Call the model through `generateGoverned` (config-driven model, structured
   JSON against the prompt's output schema, no tools — the model cannot act).
5. Store the result as a **DRAFT** `commentary` component: `draft_text` plus the
   structured fields, the `ai_run_id`, model, prompt code, confidence,
   data-through date and cited sources. `finishRun` closes the audited run.

A refusal or missing structured output finishes the run as `REFUSED`/`FAILED` and
stores nothing — no draft is fabricated.

## Draft → review → approve → lock governance (CR §12)

- **Draft.** New commentary is `ai_status = 'DRAFT'`; the section's
  `commentary_status` becomes `DRAFT`. The original AI text is always retained in
  `draft_text`.
- **Edit.** `editReportCommentary` lets a human amend the working text while it is
  `DRAFT` or `REVIEWED`; it stays a draft.
- **Review.** `reviewReportCommentary(componentId, "APPROVED"|"REJECTED", …)`
  records the sign-off — `reviewed_by`, `reviewed_at`, an optional review note —
  and sets `approved_text` (the supplied final wording, or the draft) on approval.
  Only a `DRAFT`/`REVIEWED` component can be decided; an already-decided one is
  immutable.
- **Lock.** On report approval the version snapshot bakes in **approved** text
  only; unreviewed drafts are excluded.

## Unreviewed commentary cannot enter an issued report

This is enforced, not advisory. The validation checklist
(`validation-rules.js`) marks the `commentary_reviewed` check **FAILED** if any
commentary component is still a `DRAFT`, and a FAILED validation blocks
`ready_for_approval`, `approve` and `issue`. The PPTX/print exporters only render
approved commentary for a final report (a draft export watermarks and clearly
marks any draft text). So an AI draft can never silently become part of an issued,
governed document.
