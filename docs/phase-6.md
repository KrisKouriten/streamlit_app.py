# Phase 6 — Real Xero finance feed & consolidated dashboards

Delivered 20/07/2026. Scope: move the specialist finance dashboards (Management
Accounts, Budget & Forecast, Cash Flow) and the Executive Hub's finance tiles off
illustrative demo data and onto **real, reconciled Xero actuals**, consolidated
across connected legal entities. Built as chosen: scaffold the feed-agnostic
ingestion + entity mapping, then do a real load now; wire ongoing automation later.

## Two feeds, kept separate

The hub now shows two distinct truths, each tagged so they can never be read as
the same number:

- **Trading (store feed) — all stores.** Revenue and gross margin, live from
  `commercial.fact_store_sales` (≈£18.0m YTD). Chip: **Store · all**.
- **Statutory finance (Xero) — connected entities only.** Revenue, gross profit,
  net result and cash from Xero. Chip: **Xero**. Today one entity is connected
  (**Kouriten Cambridge Limited**, trading as Miniso UK — Cambridge), so these are
  a single small entity (≈£330k H1), not the group. The scope is stated on every
  finance screen.

## Architecture note

The Vercel-hosted app cannot call the Xero connector — MCP connectors only run
inside a Claude session. So the feed is split:

- `lib/xero-rules.js` — **pure, unit-tested** mapping from a Xero P&L to the six
  Finance OS accounts. Income positive, costs/expenses negative (so
  `SUM(amount_gbp)` = net profit). It **reconciles its own output to Xero's
  section totals** and returns `ok:false` if a penny is lost; unmapped accounts
  fall to their section default and are reported, never silently dropped.
- `lib/xero-ingest.js` — the **feed-agnostic write path**. `ingestExtract()` takes
  a normalized extract (already mapped) and upserts it into `finance.fact_financials`
  / `fact_bank_position` tagged `source_system = 'XERO'`, idempotent per
  (entity, scenario, period), and writes the refresh log. It never talks to Xero.
- The Xero → normalized transform is produced in a Claude session (this one, or a
  future scheduled routine) and handed to `ingestExtract`.

## Database — migration 006 (`006_xero_finance_feed.sql`)

Idempotent, rollback in header. Adds the **KCL** entity (parent MUK), a dedicated
**XERO-ACT** actual scenario, the connected-entity registry
`finance.xero_org_map` (one row per Xero org we consolidate, with `feed_status`
and `last_loaded_at`), and a `source_system` tag on `fact_bank_position`
(`fact_financials` already had one). Real rows are tagged `XERO`; the demo data
stays tagged `DEMO` and is simply no longer surfaced — nothing is deleted.

## The real load (reconciled to the penny)

Kouriten Cambridge Limited, H1 2026 (Jan–Jun), pulled live from Xero:

| Finance OS account | Amount |
|---|---|
| Revenue | £329,683.36 |
| Cost of Goods Sold | −£132,648.72 |
| Store Labour | −£89,264.35 |
| Occupancy & Rent | −£123,317.59 |
| Other Store Costs | −£8,777.00 |
| Central Overheads | −£1,588.96 |
| **Net result** | **−£25,913.26** |

Revenue, cost of sales, total expenses and net result each match Xero's own
report exactly (`reconciliation.ok === true`, zero unmapped). Cash at bank
£1,623.43 (reconciled). The Neon load SQL is delivered to finance separately — it
holds real financial figures and, like the store data load, is kept out of the repo.

## Dashboards rebuilt on the real feed

`lib/finance-os.js` gains `getConnectedEntities`, `getRealPL`,
`getRealCashPosition`, `getRealFinanceSnapshot` — all filtered to
`source_system = 'XERO'` and consolidated across connected entities.

| Screen | Now shows |
|---|---|
| Management Accounts | Real Xero P&L by account + scope banner; budget/forecast blank (planning feed pending) |
| Budget & Forecast | Real actuals; budget/forecast intentionally blank until a real plan is loaded — no illustrative numbers |
| Cash Flow & Treasury | Real Xero cash; facilities/forward movements pending the treasury feed |
| Executive Hub | Four finance tiles are now real Xero (Revenue, Gross profit, Net result, Cash) with a scope line; trading tiles unchanged |

A shared `EntityScopeBanner` states which entities are live and as at when, on
every finance screen.

## Tests
`tests/xero.test.mjs` — 7 unit tests over `mapProfitAndLoss`: reconciliation to
Xero totals, sign handling, net = sum of lines, the four-bucket opex split,
unmapped-account handling, and mismatch detection. `npm test`: **37/37** green.

## Acceptance criteria (verified on the production-replica DB, real Xero pull)
- [x] Migration 006 twice-run clean; KCL entity, XERO-ACT scenario, registry seeded.
- [x] Real H1 P&L loaded and **reconciles to Xero to the penny**; net result −£25,913.26.
- [x] Management Accounts / Budget & Forecast / Cash Flow render real Xero data with the consolidation-scope banner; ADMIN and OPS; no page errors.
- [x] Executive Hub finance tiles are real Xero, scope-labelled; trading tiles (all stores) unchanged; the two scopes are visually distinct.
- [x] No screen mixes DEMO and XERO rows (all finance reads filter `source_system`).
- [x] `npm test` 37/37; production build clean.

## Post-merge steps for the owner (Neon)
1. Run `db/migrations/006_xero_finance_feed.sql` (safe to re-run).
2. Run the Cambridge load SQL delivered separately (real financials — not in the repo).
3. Finance dashboards then show real, consolidated Xero figures for the connected entity.

## Refreshing / adding entities
- **Refresh Cambridge:** in a Claude session, re-pull the Xero P&L + cash, run it
  through `mapProfitAndLoss`, and call `ingestExtract` (or regenerate the load SQL).
  Idempotent — it replaces the period's slice.
- **Add an entity:** connect its Xero org, add a `dim_entity` + `finance.xero_org_map`
  row, then load it. The dashboards consolidate it automatically and the scope
  banner updates.

## Not in this phase (follow-ups)
- Ongoing automation: either a native `xero-node` + OAuth integration with a Vercel
  Cron, or a scheduled Claude routine calling `ingestExtract`. Deferred by design.
- Monthly P&L granularity (loaded as one H1 period for now), real budget/forecast
  from the planning cycle, the balance-sheet feed (working capital, net equity),
  the treasury feed (facilities, forward cashflow), and an automated store-sales
  reload. Each is a data-source connection, not app work.
- The brand/visual pass (still queued for after this phase) — share your strategy
  template and I'll apply it across the app in one go.
