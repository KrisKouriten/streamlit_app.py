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
