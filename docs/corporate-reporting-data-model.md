# Corporate Reporting Centre — Data Model

_Miniso UK Finance OS. The schema created by migration **045**
(`db/migrations/045_reporting_centre.sql`). All tables live in the `finance`
schema; AI configuration reuses the `intelligence` schema from migration 038._

The migration is additive and idempotent (`IF NOT EXISTS`, guarded inserts,
`ON CONFLICT DO NOTHING`) and safe to re-run. A rollback block is documented at
the head of the file.

## Shape in one line

`report_template` → `report_template_section` define the reusable standard.
A `report_instance` is one report for a period; it owns
`report_section_instance` rows (each a page), which own `report_component` rows
(the atoms). `report_version` freezes a resolved snapshot; `report_export`
records every generated artifact; `report_schedule` holds the (schema-only in
this release) recurring cadence.

## Tables

### `finance.report_template`

The official, reusable report definitions. Corporate templates are the company
standard; team/personal variants are anticipated by the `classification` column.

| Column | Type | Notes |
|---|---|---|
| `template_id` | bigint PK | identity |
| `template_key` | varchar(48) UNIQUE | e.g. `WEEKLY_TRADE_PACK` |
| `name`, `purpose`, `audience`, `frequency` | text/varchar | descriptive |
| `default_owner_role` | varchar(32) | default `FINANCE` |
| `classification` | varchar(12) | `CORPORATE` \| `TEAM` \| `PERSONAL` |
| `default_confidentiality` | varchar(16) | `PUBLIC` \| `INTERNAL` \| `CONFIDENTIAL` \| `BOARD` \| `RESTRICTED` |
| `default_ai` | jsonb | default perspective keys |
| `is_active`, `effective_date`, `created_by`, `created_at`, `updated_at` | — | lifecycle |

### `finance.report_template_section`

The default ordered structure of a template. `UNIQUE (template_id, section_key)`;
indexed on `(template_id, position)`.

| Column | Type | Notes |
|---|---|---|
| `section_id` | bigint PK | identity |
| `template_id` | bigint FK → `report_template` | `ON DELETE CASCADE` |
| `section_key`, `title`, `purpose` | — | |
| `position` | int | order within the template |
| `mandatory` | boolean | a mandatory section cannot be excluded |
| `default_source_key` | varchar(48) | the source adapter for the page |
| `default_ai_perspective` | varchar(32) | default commentary lens |
| `default_page_type`, `default_layout` | varchar(32) | presentation intent |

### `finance.report_instance`

A specific report for a period/scope, with its lifecycle. Indexed on
`created_at DESC`, `status` and `owner`.

| Column | Type | Notes |
|---|---|---|
| `report_id` | bigint PK | identity |
| `template_id` | bigint FK → `report_template` | `ON DELETE SET NULL` |
| `template_key` | varchar(48) | denormalised for listing |
| `title` | varchar(200) | |
| `reporting_period` | varchar(40) | e.g. `2026-W30`, `2026-06` |
| `data_through_date` | date | freshness anchor |
| `comparator` | varchar(24) | `BUDGET` \| `LATEST_FORECAST` \| `PRIOR_YEAR` \| … |
| `forecast_version`, `budget_version`, `scenario` | — | planning context |
| `currency` | varchar(8) | default `GBP` |
| `display_units` | varchar(12) | `GBP` \| `GBP_000` \| `GBP_M` |
| `scope` | jsonb | `{ entities:[], stores:[], departments:[], franchises:[] }` |
| `audience`, `owner`, `reviewer`, `approver` | varchar | governance roles |
| `expected_issue_date`, `issue_date` | date | |
| `confidentiality` | varchar(16) | CHECK against the five labels |
| `status` | varchar(20) | CHECK against the 12 lifecycle statuses |
| `version_seq` | int | latest issued version sequence |
| `version_label` | varchar(24) | e.g. `Draft v0.1`, `Approved v1.0` |
| `created_by`, `created_at`, `updated_at` | — | |

### `finance.report_section_instance`

The ordered sections of one report. In this release a **section IS a page** (1:1);
`page_type` / `layout` carry the presentation intent so a finer page layer can be
added later without a schema change. Indexed on `(report_id, position)`.

| Column | Type | Notes |
|---|---|---|
| `section_inst_id` | bigint PK | identity |
| `report_id` | bigint FK → `report_instance` | `ON DELETE CASCADE` |
| `template_section_id` | bigint FK → `report_template_section` | `ON DELETE SET NULL`; carries the `mandatory` flag by join |
| `section_key`, `title`, `purpose` | — | |
| `position`, `included` | int / boolean | order and include/exclude |
| `page_type`, `layout` | varchar(32) | `cover`, `exec_summary`, `content`, `risk_opp`, `action`, `decision`, `appendix` … |
| `filters`, `source_key`, `ai_perspective` | jsonb / varchar | data binding |
| `data_status` | varchar(16) | `PENDING` \| `READY` \| `PARTIAL` \| `MISSING` |
| `commentary_status` | varchar(16) | `NONE` \| `DRAFT` \| `REVIEWED` \| `APPROVED` \| `REJECTED` |
| `approval_status` | varchar(16) | default `PENDING` |

### `finance.report_component`

The atoms rendered on a page. A `commentary` component carries its own
draft → sign-off state and a link to the auditable AI run. Indexed on
`(section_inst_id, position)` and `report_id`.

| Column | Type | Notes |
|---|---|---|
| `component_id` | bigint PK | identity |
| `report_id`, `section_inst_id` | bigint FK | both `ON DELETE CASCADE` |
| `component_type` | varchar(24) | CHECK: `cover`, `contents`, `exec_summary`, `kpi_row`, `kpi`, `table`, `chart`, `commentary`, `action`, `risk_opp`, `decision`, `appendix`, `text`, `source_footer` |
| `title`, `position` | — | |
| `source_key`, `filters`, `config` | varchar / jsonb | data + display settings |
| `ai_perspective` | varchar(32) | commentary lens |
| `ai_status` | varchar(12) | CHECK: `NONE` \| `DRAFT` \| `REVIEWED` \| `APPROVED` \| `REJECTED` |
| `ai_run_id` | bigint FK → `intelligence.ai_run` | `ON DELETE SET NULL` — the audit link |
| `ai_model`, `ai_prompt_code`, `ai_confidence`, `ai_data_through`, `ai_sources` | — | provenance of the draft |
| `draft_text` | text | the original AI output (always retained) |
| `approved_text` | text | the final approved wording |
| `reviewed_by`, `reviewed_at` | — | sign-off record |

### `finance.report_version`

A frozen snapshot of the whole assembled report. An approved version is
`locked` and never changes when the underlying data moves.
`UNIQUE (report_id, seq)`; indexed on `(report_id, seq DESC)`.

| Column | Type | Notes |
|---|---|---|
| `version_id` | bigint PK | identity |
| `report_id` | bigint FK → `report_instance` | `ON DELETE CASCADE` |
| `seq` | int | monotonic per report |
| `label` | varchar(24) | `Draft v0.2`, `Approved v1.0` |
| `snapshot` | jsonb | fully resolved report — figures + approved commentary + sources |
| `status` | varchar(20) | report status at snapshot |
| `change_summary` | text | |
| `locked` | boolean | true on approval |
| `created_by`, `created_at` | — | |

### `finance.report_export`

A record of every generated artifact (never a screenshot source). Indexed on
`(report_id, created_at DESC)`.

| Column | Type | Notes |
|---|---|---|
| `export_id` | bigint PK | identity |
| `report_id` | bigint FK → `report_instance` | `ON DELETE CASCADE` |
| `version_id` | bigint FK → `report_version` | `ON DELETE SET NULL` — null for a live export |
| `format` | varchar(8) | CHECK: `PPTX` \| `PDF` \| `XLSX` |
| `checksum` | varchar(80) | SHA-256 (truncated) of the file bytes |
| `byte_size` | int | |
| `watermark`, `confidentiality` | varchar | |
| `exported_by`, `created_at` | — | |

### `finance.report_schedule`

The recurring cadence for a template. The system **may** auto-create a draft; it
must never auto-issue an unreviewed report. Partial index on `next_due` where
`is_active`. **Schema-only in this release** — no engine code reads or writes it
yet (see the release report; scheduling automation is deferred).

Key columns: `template_key`, `name`, `frequency`, `cadence_note`, `owner`,
`reviewer`, `approver`, `next_due`, `data_cutoff_rule`, `issue_deadline_rule`,
`recipients` (jsonb), `reminder_rule`, `auto_generate`, `is_active`.

## Intelligence configuration (reuses `intelligence.*` from migration 038)

- `intelligence.model_configuration` gains a `REPORT_COMMENTARY` use-case
  (`claude-sonnet-5`, effort `high`, 3,500 max tokens, 60s timeout, prompt code
  `REPORT_COMMENTARY_V1`) — swappable without a deploy.
- `intelligence.prompt_version` gains `REPORT_COMMENTARY_V1` v1: a governance
  system prompt (governed figures only, draft-only, en-GB formatting, no action)
  plus a strict output schema (`headline`, `body`, `drivers`, `risks`,
  `opportunities`, `recommended_actions`, `financial_effect`,
  `data_limitations`, `confidence`, `sources`).

## The lifecycle status enum

`report_instance.status` and `reporting-rules.js` `REPORT_STATUSES` share these
twelve values, in lifecycle order:

```
DRAFT → DATA_PENDING → COMMENTARY_PENDING → REVIEW_READY → IN_REVIEW
→ RETURNED → APPROVAL_READY → APPROVED → ISSUED
→ SUPERSEDED → ARCHIVED → CANCELLED
```

**Editable:** `DRAFT`, `DATA_PENDING`, `COMMENTARY_PENDING`, `RETURNED`.
**Locked:** `APPROVED`, `ISSUED`, `SUPERSEDED`, `ARCHIVED`, `CANCELLED`.

See `docs/report-validation-framework.md` for the transition rules and the gates
that a failed validation blocks.
