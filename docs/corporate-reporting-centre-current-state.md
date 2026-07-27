# Corporate Reporting Centre — Current-State Assessment

_Miniso UK Finance OS. The capability review that preceded the build — what the
platform already did, and the gap the Corporate Reporting Centre was built to
close._

## Purpose of this note

Before building the Reporting Centre we assessed what the platform could already
do so the new work reused proven machinery rather than duplicating it. This
document records that pre-build state: the capabilities that were built on, and
the deliberate gaps the Centre now fills.

## What already existed (and was reused)

### 1. A self-serve Report Builder (Phase 35, `finance.report_def`)

A saved-report tool already lived at **`/reports`** (Govern). It generalised the
P&L Format Builder: a report was a *dataset + parameters*, re-run and exported on
demand. Its datasets (Consolidated P&L, Balance Sheet, Management Accounts board
pack) each adapted to a common render-row shape
`{ months, rows:[{kind,label,values,total,…}], year }`.

- **Strength reused:** the idea that a report is a saved definition resolved
  against a governed read layer, not a hand-built artifact.
- **Limitation:** it produced a single tabular document from one dataset. It had
  no concept of a multi-section deck, a lifecycle, versioning, or narrative.

### 2. Board packs and a generic Excel workbook builder

The Management Accounts board-pack path and the generalised
`buildWorkbook({ title, tabs, period })` (`lib/ma-export.js`) already turned a
tab structure into a clean multi-sheet Excel file. The board-pack row shape was
well established.

- **Strength reused:** the pattern of writing *raw numbers* (Excel formats them)
  so an export is analysable, not a picture. The Reporting Centre's Excel
  appendix (`lib/reporting/export-xlsx.js`) follows the same principle.
- **Limitation:** Excel only. There was no native slide/deck output.

### 3. Print-to-PDF via app-wide CSS

A global `@media print` shell-strip lived in `app/layout.js` (from the Tier 2.1
management-accounts export). It forces black-on-white, hides chrome, and breaks
each `.fos-print-tab` onto its own page.

- **Strength reused:** the Reporting Centre's print view
  (`/finance-os/home/reports/[id]/print`) renders each section as a
  `.fos-print-tab` and relies on this same CSS. PDF is "Save as PDF" from the
  browser dialog — no new rendering stack.
- **Limitation:** PDF depends on a human pressing print. There is no
  server-rendered, headless-Chrome PDF.

### 4. The governed Finance Intelligence Layer (migrations 038/042)

A shared, governed Intelligence Layer already served Finance Buddy and AI
Perspective, and — in Phase 5b — drafted commentary with a **draft → sign-off**
workflow (`lib/intelligence/commentary.js`, migration 042). It resolves
permissions first, retrieves *only* governed figures through
`gatherEvidence` (`lib/intelligence/retrieval.js`), interprets rather than
computes, assigns honest confidence, records an auditable `ai_run`, and never
takes an action. Board/investor commentary stayed a draft until a person signed
it off.

- **Strength reused:** the Reporting Centre's AI commentary
  (`lib/reporting/report-commentary.js`) reuses this layer **end-to-end** —
  `gatherEvidence` for facts, `generateGoverned` for the model call, `openRun` /
  `recordStep` / `recordSources` / `finishRun` for the audit trail, and the same
  draft-then-approve discipline. No second AI system was built.
- **Limitation:** commentary was subject-level (management accounts, cash,
  trading, board pack) and lived on its own page. It was not attached to a
  section of a composed report, nor bound to a report's lifecycle.

### 5. Governed source services and the Action Centre

Every dashboard figure already came from an approved calculation service
(store sales, management-accounts variance, franchise, inventory health, SKU,
forecast, cash, close), and the Action Centre held governed actions with owners,
due dates and expected value. These are the same services the new source
adapters delegate to, so a report reconciles to its source.

## What was missing (the gap this build closes)

The platform could resolve a single dataset and export it, and it could draft
governed narrative — but it could not compose a **report as an object**. The
specific gaps:

- **Deck composition.** No notion of a template → ordered sections (pages) →
  components (KPI / table / chart / commentary / action). A report was one table,
  not a structured deck.
- **A report lifecycle.** No governed state machine
  (draft → review → approval → approved → issued → archived), no reviewer /
  approver gates, and nothing to stop an unfinished report being treated as
  final.
- **Native PowerPoint.** Board and executive audiences expect a deck. There was
  no native `.pptx` output — only Excel and print-to-PDF.
- **Versioning.** Nothing froze an approved report, so a "final" document would
  silently change as the underlying data moved.
- **Validation.** No pre-issue checklist to confirm mandatory sections are
  present, data is fresh, commentary is reviewed and a confidentiality label is
  set.
- **Section-level, governed AI commentary.** Commentary existed but was not
  anchored to a report section, a perspective and a comparison basis, nor
  gated so unreviewed text could not enter an issued report.
- **Scheduling and "Add to Report".** No cadence for recurring reports, and no
  way to send a dashboard view into a draft report as live, governed data rather
  than a screenshot.

## The build in one line

One governed **Corporate Reporting Engine** — a template-derived report instance
of ordered sections and components, moving through a governed lifecycle, drawing
every figure from the existing governed services via source adapters, drafting
commentary through the reused Intelligence Layer, and exporting to native PPTX,
Excel and print/PDF — not five isolated report generators.
