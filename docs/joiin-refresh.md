# Joiin refresh — runbook (scheduled auto-refresh)

The Finance OS app reads finance data from Neon; it cannot call Joiin directly.
The Joiin connection lives in a Claude session (an MCP connector). This runbook
is what the scheduled **Joiin refresh Routine** follows to pull from Joiin and
load Neon, with no manual upload.

## Preconditions (must be true in the scheduled environment)
1. **`DATABASE_URL` points at Neon** (production). A fresh session does not have
   `.env.local` (gitignored), so this must be set as an environment variable /
   secret in the Claude Code environment settings. Without it the load step
   stops and reports the missing connection.
2. **The Joiin connector is available** to the scheduled (headless) session. If
   it isn't, the pull step stops and reports it — then use the in-app upload
   (Govern → P&L Formats) or the app-side Joiin API integration instead.

## Steps the Routine performs
1. Determine the target months (current month + the prior month).
2. Pull the **consolidated** P&L per month via `run_financial_report`
   (reportType `profit-loss`, companyIds `["all"]`, currency GBP,
   eliminationType `eliminate`, monthly columns). Save each to
   `scratchpad/joiin_reports/<YYYY-MM>.md` style files.
3. Pull the **by-company** P&L per month (compareTypes `["by-company"]`,
   eliminationType `none`, one call per month). Save each as
   `scratchpad/joiin_reports/by-company/<YYYY-MM>.md`.
4. Load:
   - `node scripts/refresh-load.mjs consolidated <consolidated-dir>`
   - `node scripts/refresh-load.mjs by-company <by-company-dir>`
   Both are idempotent (clear covered months, then upsert).
5. Verify: the consolidated loader prints derived-net vs Joiin Net Profit per
   month (should reconcile within rounding). Report the month(s) refreshed,
   row counts, and any reconciliation diffs.

Client id and entity map live in `lib/entity-map.js`. Parsers in
`lib/joiin-rules.js`. Loader in `scripts/refresh-load.mjs`.

## Board packs (Management Accounts — four tabs)

The four-tab Management Accounts view (Store · Head Office · Franchise ·
Consolidated) renders Joiin's own **Custom Report board packs** — each pack is
laid out and consolidated by Joiin (wholesale intercompany sales eliminated),
so the app stores it verbatim in `finance.joiin_boardpack` (migration 023) and
renders it row for row. Scope → `customReportId` is in `lib/joiin-reports.js`.

Refresh paths:
- **App-side Joiin API** (`POST /api/joiin-refresh`, ADMIN/FINANCE, or Vercel
  Cron with `CRON_SECRET`): after the per-entity P&L it also pulls each board
  pack via `report/custom-report` and upserts `finance.joiin_boardpack`. The
  response's `boardPacks` field reports how many packs loaded and any errors
  (best-effort — a failing pack does not fail the per-entity refresh). The exact
  custom-report JSON field names should be confirmed on the first live run and
  `mapBoardPackRows` (in `lib/joiin-api-map.js`) adjusted if needed.
- **Seed** (`db/seeds/joiin_boardpack_2026-06.sql`): the June 2026 packs pulled
  via the connector, so the view has data before the API refresh runs. Idempotent.

The per-store scroller on the Store tab reads the per-entity standalone P&L
(`finance.joiin_pl_entity`); "All stores — consolidated" and the other three
tabs read the board pack.
