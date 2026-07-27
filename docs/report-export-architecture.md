# Report Export Architecture

_Miniso UK Finance OS. Native PowerPoint, print/PDF and Excel appendix, plus
version snapshots and export records — `lib/reporting/export-pptx.js`,
`lib/reporting/export-xlsx.js`, the print view, and the export route (CR §16)._

## Principle

Every export is a native, native-object artifact built from the report's governed
figures and approved commentary — **never a screenshot**. All three formats
consume the same assembled shape, so they stay consistent, and every generated
file is recorded with a checksum.

## The assembled shape

Both the export route and the version snapshot produce the same structure the
renderers read:

```
{ report:{ title, reporting_period, data_through_date, confidentiality,
           display_units, status, version_label },
  sections:[{ title, page_type, kpis:[{label,value,unit}], table:{columns,rows},
              components:[{ type, aiStatus, approvedText, draftText, title }],
              sourceRoute, dataThrough }] }
```

The export route (`/api/reports-centre/[id]/export`) either resolves the report
live (`resolveReport` → `assembleFromResolved`) or, when `?version=` is supplied,
loads a **locked snapshot** from `report_version` and exports exactly that frozen
content.

## PowerPoint (pptxgenjs)

`buildDeckPptx(assembled, { includeDraftCommentary, watermarkText })` builds a
native deck (`pptxgenjs`) on a custom 10 × 5.63 layout, styled to the Finance OS
identity (see the design-system doc):

- **Cover** — accent band, brand line `MINISO UK · FINANCE OS`, title, period and
  data-through subtitle, confidentiality line, optional watermark.
- **One slide per included section** — title with an accent rule; up to five KPI
  tiles across; a governed table with an accent header row (capped at ten rows,
  money columns formatted via `formatReportMoney`); approved commentary, or draft
  commentary clearly marked **"AI DRAFT — not yet reviewed"** when
  `includeDraftCommentary` is set.
- **Footer on every content slide** — brand, source route, data-through date,
  confidentiality and page number.

Returns a Node `Buffer`. Content type
`application/vnd.openxmlformats-officedocument.presentationml.presentation`.

## PDF (print view)

There is no headless-Chrome renderer in this release. PDF is produced from the
**print view** `/finance-os/home/reports/[id]/print`, which renders each section
as a `.fos-print-tab` and relies on the **app-wide** `@media print` CSS in
`app/layout.js` (black-on-white, chrome hidden, one page per tab). Only
**approved** commentary is printed. The user saves as PDF from the browser
dialog. (The `report_export` table accepts a `PDF` format for when a server-side
PDF is added later.)

## Excel appendix (xlsx)

`buildAppendixWorkbook(assembled)` turns the report's tables and KPIs into a
supporting workbook (`xlsx`):

- A **Summary** sheet listing every KPI across the report (section, KPI, value).
- **One sheet per section** that carries a table.
- **Raw numbers** are written and money columns get a `#,##0` cell format, so the
  appendix is analysable rather than a picture.
- Every sheet carries the review note: _"Miniso UK — internal management
  reporting. Review before any external use."_

Content type
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

## Draft vs final selection

The route derives the treatment from report status:

- **Not APPROVED/ISSUED** → watermark `DRAFT`, and the PPTX includes clearly
  marked draft commentary.
- **APPROVED/ISSUED** → only approved commentary; a `BOARD`/`RESTRICTED` report is
  watermarked with its confidentiality label.

## Version snapshots

`snapshotVersion(reportId, { scope, status, label, locked, changeSummary })`
resolves the report and writes a frozen `report_version` row whose `snapshot`
jsonb holds the fully assembled report — figures, tables, **approved** commentary
(unreviewed drafts excluded), sources and data-through dates. On **approve**, the
engine snapshots automatically with `locked: true` and an `Approved v1.x` label,
so the approved version never changes when the underlying data moves. Users can
also take an unlocked **draft snapshot** at any editable stage. `version_seq` and
`version_label` on the instance track the latest sequence; the builder lists
versions and links each to a PPTX export of that snapshot.

## Export records with checksum

Every generated file is recorded via `recordExport`:

- A **SHA-256 checksum** of the file bytes (first 32 hex chars), the byte size,
  the format (`PPTX`/`PDF`/`XLSX`), the watermark, the confidentiality label and
  the exporting user, plus the `version_id` when a snapshot was exported.
- A `report.export` audit event is written through the shared governance audit.

This gives a permanent, tamper-evident trail of exactly which artifact was
generated, from which version, by whom.
