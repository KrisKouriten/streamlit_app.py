# Corporate Reporting Centre — Release Report

_Miniso UK Finance OS. Executive summary of what shipped, what is deliberately
deferred, and the acceptance criteria (CR §32) with a status for each._

## Summary

The Corporate Reporting Centre ships as **one governed Corporate Reporting
Engine**: a template-derived report of ordered sections and components that moves
through a governed lifecycle, draws every figure from the existing governed
Finance OS services via source adapters, drafts commentary through the reused
Finance Intelligence Layer (draft → human sign-off), validates before issue,
freezes approved versions, and exports to native PowerPoint, Excel and print/PDF.
The **Weekly Trade Pack** is wired end-to-end; the other four templates are fully
seeded and usable. Live at **HOME → Corporate Reporting Centre**
(`/finance-os/home/reports`).

## What shipped

- **The engine** — templates → report instance → sections (pages) → components,
  with a governed 12-state lifecycle, every mutation audited (migration 045;
  `lib/reporting/*`).
- **Weekly Trade Pack, end-to-end** — 17 sections resolving against live/governed
  data through the source adapters.
- **Five templates visible from day one** — Weekly Trade Pack, Management
  Accounting Report, Finance Board Deck, Budget & Forecasts Deck, Franchise Deck.
- **The three-panel builder** — structure (include/reorder), governed page
  preview, and settings/AI/validation/versions.
- **Source adapters** — a common envelope over the governed services; unbuilt
  feeds (treasury, wholesale, purchase orders) return an honest "awaiting", never
  invented figures.
- **AI commentary with sign-off** — ten perspectives, detail/tone/comparison
  settings, drafted over governed facts through the Intelligence Layer, auditable,
  and blocked from an issued report until reviewed.
- **Validation** — a PASSED/WARNING/FAILED checklist; FAILED blocks approval and
  issue.
- **Versioning** — approved reports freeze a locked snapshot that never changes
  when data moves.
- **Exports** — native PPTX (pptxgenjs), Excel appendix (raw numbers), print/PDF;
  every export recorded with a SHA-256 checksum.
- **Add to Report** — send a dashboard view into a draft as live governed data
  (source key + filters), never a screenshot.

## Deliberately deferred (fast-follow)

- **Native headless-Chrome PDF.** PDF remains "Save as PDF" from the print view
  using the app-wide print CSS; no server-side PDF renderer yet.
- **Scheduling automation.** The `report_schedule` table exists, but no engine
  reads or writes it — recurring auto-draft creation and reminders are not wired.
- **Granular finance roles.** FINANCE and ADMIN currently share
  create/review/approve; EXEC is view-only. A distinct preparer/reviewer vs
  approver split is not yet enforced (the `reviewer`/`approver` fields already
  exist to support it).
- **The other four templates wired to full data.** Management Accounting, Finance
  Board, Budget & Forecasts and Franchise decks are seeded and usable but lean on
  adapters that are partly awaiting dedicated feeds (treasury, wholesale, PO, and
  some illustrative-seed services).

## Acceptance criteria (CR §32)

| # | Criterion | Status |
|---|---|---|
| 1 | One governed engine (template → instance → sections → components), not five generators | **Met** |
| 2 | Five corporate templates visible and usable from day one | **Met** |
| 3 | At least one template wired end-to-end to governed data | **Met** — Weekly Trade Pack (17 sections) |
| 4 | Every figure traceable to a governed source; report reconciles to source | **Met** — adapters delegate to the same governed services as dashboards |
| 5 | No invented figures; unbuilt feeds shown honestly as "awaiting" | **Met** — awaiting adapters, degrade-never-fabricate |
| 6 | Governed lifecycle with reviewer/approver gates | **Met** — 12-state machine, audited transitions |
| 7 | Validation checklist; FAILED blocks approval/issue | **Met** |
| 8 | AI commentary governed, draft-only until human sign-off; auditable | **Met** — reuses the Intelligence Layer; unreviewed drafts blocked from issue |
| 9 | Approved reports frozen as immutable versions | **Met** — locked snapshot on approve |
| 10 | Native deck export (not a screenshot) | **Met** — native PPTX + Excel appendix + print/PDF |
| 11 | Exports recorded with integrity metadata | **Met** — checksum, size, watermark, confidentiality, audited |
| 12 | Add dashboard content to a report as live governed data | **Met** — Add to Report saves source + filters |
| 13 | Native headless-Chrome PDF | **Deferred** — print-to-PDF only for now |
| 14 | Scheduling / recurring cadence automation | **Deferred** — schema present, automation not wired |
| 15 | Granular preparer/reviewer/approver role separation | **Deferred** — FINANCE/ADMIN share manage rights this release |
| 16 | Remaining four templates wired to full live data | **Partial** — seeded and usable; some sections awaiting feeds |

## Deployment

Run migration **045** (idempotent) on the database; it creates the reporting
schema, seeds the five templates and registers the `REPORT_COMMENTARY` model
config + `REPORT_COMMENTARY_V1` prompt (reusing the migration-038 intelligence
tables). No new environment variables — AI commentary uses the existing
`ANTHROPIC_API_KEY` and the governed Intelligence Layer. Before the migration is
applied, the Centre degrades to an honest "not migrated yet" state.
