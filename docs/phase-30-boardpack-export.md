# Phase 30 — Management Accounts board-pack export (Excel + PDF)

**Tier 2, item 1 of 3 ("Match the best").** One-click **Excel** download and a
**Print / Save-as-PDF** view of the four-tab Management Accounts board pack
(Store · Head Office · Franchise · Consolidated) for the year and reporting
period currently in view.

## What it does

- **Where:** the ⤓ **Excel** button on the Management Accounts toolbar
  (`/finance-os/management-accounts`), next to the Year toggle.
- **What downloads:** an `.xlsx` workbook, one sheet per *loaded* scope, for the
  selected **period** (Current month / Trailing months / YTD) and **year**.
- **Fidelity:** rendered from the *same* `resolveTab` + `applyPeriod` path as the
  on-screen pack, so the workbook always matches the app. Money cells format
  `#,##0`; margin (%) rows format `0.0%`. Header + title rows are frozen.
- **Governance:** every download writes an audit event
  (`management_accounts.export`). Each sheet carries the note *"Internal
  management reporting — review before any external use."* This is management
  reporting (not statutory accounts), so it is unrestricted internal output.

## Shape (single source of truth)

The board-pack tab logic was factored out of the page so the screen and the
export share it:

- `lib/ma-export-rules.js` — **pure**: `monthLabel`, `applyPeriod` (period
  reshaping), `buildTabAoa` (view → array-of-arrays for xlsx), `PERIOD_LABEL`.
  Unit-tested in `tests/ma-export.test.mjs`.
- `lib/ma-boardpack-view.js` — **server**: `resolveTab` (moved out of the page),
  `resolveAllTabs` (all four scopes for the export), and the `SCOPES` /
  `TAB_LABEL` / `SCOPE_NOTE` / `PERIODS` constants.
- `lib/ma-export.js` — builds the workbook (`buildManagementAccountsWorkbook`)
  using the `xlsx` dependency; mirrors the existing `lib/forecast.js` export.
- `app/api/management-accounts/export/route.js` — `GET` download (signed-in,
  audited), following the `app/api/forecast/export` convention.
- `app/finance-os/management-accounts/page.js` — now imports the shared logic.
- `app/finance-os/management-accounts/mc-controls.js` — the ⤓ Excel link.

## PDF (print view)

- **Where:** the ⎙ **PDF** button on the toolbar → opens
  `/finance-os/management-accounts/print?year=&period=` in a new tab.
- The print view stacks all four scopes, each on its own page, and the app shell
  (top bar + sidebar) is marked `.no-print`, so the browser's **Print → Save as
  PDF** produces a clean board-pack PDF.
- Implemented with a global `@media print` block in `app/layout.js` (hides
  `.no-print`, black-on-white, `.fos-print-tab` page breaks, crisp table
  borders) — so *every* screen now prints cleanly, not just this one.
- Files: `app/finance-os/management-accounts/print/{page,print-button}.js`;
  `no-print` class added to `app/topnav.js` and `app/sidebar.js`.

## Not yet included (fast-follow)

- Per-store sheets in the export (currently the Store sheet is the consolidation).
