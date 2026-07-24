# Phase 30 — Management Accounts board-pack export (Excel)

**Tier 2, item 1 of 3 ("Match the best").** One-click Excel download of the
four-tab Management Accounts board pack (Store · Head Office · Franchise ·
Consolidated) for the year and reporting period currently in view.

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

## Not yet included (fast-follow)

- **Print / Save-as-PDF** of the full pack — needs a print-clean view that strips
  the app shell (nav/topbar). Deliberately deferred so the shell change is done
  carefully rather than rushed.
- Per-store sheets in the export (currently the Store sheet is the consolidation).
