# Phase 35 — Report Builder (Tier 3.3)

**Tier 3, item 3 ("Leapfrog").** Self-serve reporting: save a report as a
*dataset + parameters* and re-run / export it, without an engineer building each
one. It generalises the P&L Format Builder rather than duplicating it — the
layout grammar, the renderer and the Excel/PDF export path already existed.

## The insight

`renderFormat()`'s output, the board-pack row shape, and what the Tier 2.1
export path (`ma-export-rules` → `ma-export`) consumes are all the **same shape**
— `{ months, rows:[{kind,label,values,total,isPct,strong,tone}], year }`. So a
report is just: pick a dataset → get rows in that shape → render + export. The
heavy machinery is reused unchanged.

## What it does

- New **`/reports`** (Govern) — a saved-report list (open / ⤓ Excel / delete), a
  create form (dataset + parameters), and a rendered **preview** that prints
  clean and exports to Excel.
- **Datasets** (real data only): Consolidated P&L, Balance Sheet, Management
  Accounts board pack. Each maps to the common tab shape via a one-case adapter.
- **Export**: `GET /api/reports/[id]/export` → one Excel sheet per tab, reusing
  the generalised `buildWorkbook`. PDF via the print view (the global
  `@media print` shell-strip from Tier 2.1).

## Shape

- `lib/report-rows.js` — **pure**: `pnlToTab`, `bsToTab` (loaded dataset → the
  common render-row shape). Unit-tested in `tests/report-rows.test.mjs` (3 tests).
- `lib/report-datasets.js` — `DATASETS` catalogue + `buildReportTabs(key, params)`
  (the dataset adapter over the existing read layers).
- `db/migrations/037_report_def.sql` — `finance.report_def` (name, dataset_key,
  params jsonb, optional spec, versioned). No fixed-scope constraint (unlike
  `pl_format`) — many rows.
- `lib/report-store.js` — CRUD (audited; degrades pre-migration).
- `lib/ma-export.js` — new generic `buildWorkbook({ title, tabs, period })`; the
  MA export is now the fixed-scope case of it.
- `app/api/reports/route.js` — list / create / update / delete.
- `app/api/reports/[id]/export/route.js` — Excel download.
- `app/reports/{page,reports-ui}.js` — the builder screen.
- `lib/nav-registry.js` — **Report Builder** under Govern.

## Migration to run at merge

- **037** — creates `finance.report_def`. Until it's applied, `/reports` renders
  with an empty saved-report list (reads degrade cleanly); the datasets
  themselves still preview/export.

## Not yet included (fast-follow)

- **Custom layouts** — a report currently uses its dataset's default layout;
  binding the `spec` column to the pl-format layout editor would let a report
  re-order / rename / add subtotal lines. The `spec` column is already there.
- **More datasets** — forecast, store sales/KPI, SKU (all have read layers in
  the common style; each is one more adapter case).
- **Scheduling / distribution** — email or scheduled export of a saved report.
