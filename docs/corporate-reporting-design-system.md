# Corporate Reporting Centre — Design System

_Miniso UK Finance OS. The deck design language, the page/section/component
model, and how the screen, print and PowerPoint outputs stay consistent._

## Design intent

Reporting decks read as one governed Finance OS artifact regardless of surface:
a **warm neutral ground**, a single **olive accent**, **restrained status
colour**, spacious hierarchy and a source-and-freshness footer on every page.
The look is deliberately quiet — the figures and the narrative carry the page,
not decoration.

## The palette

The PPTX exporter (`lib/reporting/export-pptx.js`) is the canonical definition;
the screen builder and print view use the same intent via CSS variables
(`--accent`, `--ink`, `--muted`, `--line`, `--surface`).

| Role | PPTX hex | Use |
|---|---|---|
| Ground | `FBF9F4` | warm neutral slide/page background |
| Ink | `23231E` | primary text |
| Muted | `77776E` | secondary text, footers |
| Accent | `73824F` | olive — rules, cover band, table headers |
| Line | `E4DFD3` | hairlines, tile borders |
| Panel | `F3EFE6` | raised surfaces |
| Status green | `4B7A4B` | positive / approved |
| Status amber | `B6862C` | warning / draft |
| Status red | `B4483C` | fail / exception |

Status colour is used sparingly — for a validation level, a data-status dot, or
a draft-commentary marker — never as a fill across a whole page.

The brand line is **`MINISO UK · FINANCE OS`** on the cover band and every page
footer.

## The page / section / component model

A report is a three-level tree, and every surface renders the same tree:

1. **Report** — title, reporting period, data-through date, confidentiality,
   display units, version label.
2. **Section = page** — a titled page with a `page_type` (`cover`,
   `exec_summary`, `content`, `risk_opp`, `action`, `decision`, `appendix`) that
   sets the presentation intent.
3. **Components** — the atoms on a page: KPI tiles, a governed table, commentary
   blocks (with review state), and — by type — actions, risks/opportunities and
   decisions.

The section carries a governed **envelope** (from a source adapter) that supplies
its KPIs and table; components may carry their own source. Commentary components
carry their draft/approved text and status.

## Consistency across screen, print and PPTX

The three renderers consume the **same assembled shape** produced by
`resolveReport` (or a version snapshot):

```
{ report:{ title, reporting_period, data_through_date, confidentiality, display_units },
  sections:[{ title, page_type, kpis:[{label,value,unit}], table:{columns,rows},
              components:[{ type, aiStatus, approvedText, draftText }],
              sourceRoute, dataThrough }] }
```

- **Screen — the builder** (`[id]/builder.js`). KPI tiles, a scrollable table and
  commentary blocks, styled with the Finance OS CSS variables. This is the
  editing surface; it also shows draft commentary and the validation checklist.
- **Print / PDF** (`[id]/print/page.js`). Renders each section as a
  `.fos-print-tab` and relies on the **app-wide** `@media print` CSS in
  `app/layout.js` (forces black-on-white, hides chrome, breaks each tab to its
  own page). Only **approved** commentary is printed. PDF is "Save as PDF" from
  the browser dialog.
- **PowerPoint** (`export-pptx.js`). A native deck on a custom 10 × 5.63 layout:
  an accent cover band, one slide per included section, up to five KPI tiles
  across, an accent-headed table (capped at ten rows), approved commentary (or
  clearly-marked draft when requested), and a footer carrying brand, source
  route, data-through date, confidentiality and page number. Native shapes and
  tables throughout — never a screenshot.

### Money and units

A single formatter, `formatReportMoney` (`reporting-rules.js`), governs currency
across the engine and both binary exporters, honouring the report's display
units and en-GB conventions:

- `GBP` → `£1,234,567`
- `GBP_000` → `£1,235k`
- `GBP_M` → `£1.2m`
- negatives in brackets → `(£5,000)`; null → `—`

The Excel appendix writes **raw numbers** with a `#,##0` cell format on money
columns, so the workbook is analysable rather than a picture.

### Draft vs final treatment

- A non-final export (report not `APPROVED`/`ISSUED`) is watermarked `DRAFT` and
  may include draft commentary, each block marked **"AI DRAFT — not yet
  reviewed"**.
- A final export carries only approved commentary; a `BOARD` or `RESTRICTED`
  report is watermarked with its confidentiality label.

This keeps the visual language honest: the reader can always tell a working
draft from an approved, governed document.
