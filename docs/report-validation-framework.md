# Report Validation Framework

_Miniso UK Finance OS. The pre-issue checklist and the lifecycle gates —
`lib/reporting/validation-rules.js` and `lib/reporting/reporting-rules.js`
(CR §13)._

## Principle

Given a report instance, its sections and its components, produce a checklist of
results at **PASSED / WARNING / FAILED** and an overall verdict. A report with any
FAILED check **must not be approved or issued as final**. The validator is pure —
no DB, no I/O — so the rules are unit-tested independently of the database
(`tests/reporting-validation.test.mjs`).

## How it runs

`validateReport(report, sections, components, opts)` is the pure core.
`validateReportById(reportId, scope)` in the engine resolves the report (which
refreshes each section's `data_status` from its governed envelope), hydrates the
`mandatory` flag from the template, then calls the pure validator. The builder
shows the live checklist in its right-hand panel and the verdict in the action
bar.

## The checklist

| Key | Check | Level when it fails |
|---|---|---|
| `mandatory_sections` | Required sections are included | **FAILED** if any mandatory section is excluded |
| `has_content` | At least a cover and one content section (≥ 2 included) | **FAILED** |
| `data_available` | Included sections have data | **FAILED** if any is `MISSING`; **WARNING** if any is `PARTIAL`/`PENDING` |
| `data_freshness` | `data_through_date` within the threshold | **WARNING** if older than the stale-day threshold, unreadable, or unset |
| `comparator` | A comparison basis is set | **WARNING** if none |
| `commentary_reviewed` | No included commentary is still a draft | **FAILED** if any is `DRAFT`; **WARNING** if any is `REJECTED` |
| `commentary_complete` | Sections flagged for commentary have it | **WARNING** if any section commentary is still `DRAFT` |
| `confidentiality` | A confidentiality label is present | **FAILED** if none |
| `reviewer` | A reviewer is assigned | **WARNING** if none |
| `approver` | An approver is assigned | **WARNING** if none |

The freshness threshold defaults to **9 days** (`DEFAULT_STALE_DAYS`), overridable
via `opts.staleDays`; `opts.nowMs` allows deterministic testing.

## The verdict

```
overall  = FAILED if any FAILED, else WARNING if any WARNING, else PASSED
canIssue = (failed count === 0)
```

The result also returns a `summary` of pass/warn/fail counts and the per-check
`detail` strings (e.g. which mandatory sections are missing, how many days stale).

## FAILED blocks the governed gates

`reportTransitionError(action, status, { validationFailed })` in
`reporting-rules.js` is the state machine. When a report is heading through a
governed gate — `ready_for_approval`, `approve` or `issue` — the engine first runs
`validateReportById`; if `canIssue` is false it passes `validationFailed: true`,
and the transition is refused with **"Validation has failed — resolve the failed
checks before this step."**

- **WARNING does not block.** A stale-data warning, a missing reviewer, or draft
  commentary on an optional section will not stop issue — but they are surfaced so
  the reviewer decides with eyes open.
- **FAILED blocks.** A missing mandatory section, no content, missing section
  data, an unreviewed AI commentary draft, or a missing confidentiality label all
  make `canIssue` false and stop approval and issue.

The builder reflects this directly: the **Approve & lock** button is disabled
while `validation.canIssue` is false.

## Worked cases (from the tests)

- A complete, fresh, reviewed report → `overall = PASSED`, `canIssue = true`.
- Excluding a mandatory section → `mandatory_sections` FAILED, `canIssue = false`.
- An unreviewed AI commentary draft → `commentary_reviewed` FAILED,
  `canIssue = false`.
- Data three weeks old → `data_freshness` WARNING, `canIssue = true` (warnings do
  not block).
- A section with `MISSING` data → `data_available` FAILED.
- No confidentiality label → FAILED; no reviewer/approver → WARNING each.
