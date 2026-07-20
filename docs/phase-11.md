# Phase 11 — Joiin feed + Operate forecast inputs + Scenario planning

## Joiin replaces the direct Xero connection
Joiin consolidates all 26 group companies (25 Xero orgs + the group cashflow
CSV company), intercompany eliminations applied. The H1-2026 monthly
consolidated P&L was pulled via the Joiin connector, mapped to the six summary
accounts by scope prefix (ST: stores → labour/occupancy/other, HO:/FR:/
unprefixed → central; Revenue/Cost of Sales sections as-is) and loaded as
`source_system='JOIIN'` (real figures delivered separately — not in repo).
Non-P&L cashflow-company artifacts (opening cash, loans, capex) are excluded;
June net −£409,969 reconciles to Joiin's Net Profit exactly.

`getActiveSource()` prefers JOIIN when present, falling back to XERO — the
Management Accounts dashboard, Hub tiles and the pre-close checks all follow.
The scope banner reads "Real feed · Joiin — consolidated across 26 companies".
Migration 014 adds `finance.feed_meta`.

## Operate forecast inputs (`/operate/forecast`)
The workings from the two Q3-forecast models, as first-class inputs (migration
013, `finance.forecast_line`): STORES (per-store monthly sales, variable rates
as % of sales, fixed schedules), HEAD_OFFICE and FRANCHISE (modelled monthly
lines). Extraction reconciles to the models' input sheets exactly (FY26 store
sales £25.56m; 5,546 lines). Computed monthly workings per scope
(sales − variable − fixed = EBITDA), per-store FY forward look, CSV upload
(upsert on grain) + template.

## Scenario planning (`/plan/scenarios`)
Levers over the Operate inputs — forecast sales, variable rates, fixed costs —
computed live (linear over scope-month aggregates), EBITDA vs base by month,
shared saved scenarios (Base / Upside / Downside seeded). PLAN hub rebased on
these two surfaces.

## Verification
Build clean; 55/55 tests; browser-verified: Joiin banner + June group revenue
on Management Accounts, pre-close on group actuals, forecast tabs & store
forward-look, scenario chips applying levers live. Zero page errors.

## Post-merge (Neon)
Run migrations 004 → 014 (idempotent, in order), then load the delivered
files: forecast_inputs.csv (via the Forecast inputs upload) and the Joiin H1
load SQL (real financials — not in repo).
