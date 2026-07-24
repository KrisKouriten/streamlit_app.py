# Phase 34 — Three-statement model (Tier 3.2)

**Tier 3, item 2 ("Leapfrog").** The linked **P&L + Balance Sheet + Cash Flow**.
Most off-the-shelf reporting tools stop at the P&L; this ties all three together
with integrity — the cash flow is *derived* from the balance-sheet movement and
*reconciled* to the actual change in cash, so no figure is invented.

## The key unlock

The earlier assumption was that Joiin only gives a P&L. It doesn't — Joiin's
Connect API exposes **balance-sheet** (and cash-flow and trial-balance) reports
alongside the P&L. Our in-app connector had simply never implemented that
endpoint. So the balance sheet now comes straight from Joiin, automatable on the
same refresh as the P&L — no manual upload needed.

## What it does

- New **`/finance-os/three-statement`** — three tabs (P&L / Balance Sheet / Cash
  Flow) with a month selector.
  - **P&L** — the consolidated Joiin P&L (already loaded), the chosen month's column.
  - **Balance Sheet** — the consolidated Joiin BS, as-at balances, with an
    **Assets = Liabilities + Equity** integrity banner.
  - **Cash Flow** — an **indirect** statement derived from the movement between
    two consecutive month-end balance sheets: operating (net result + working
    capital), investing (non-current assets), financing (debt + equity ex the
    result), then a **reconciliation** to the actual change in cash. Any residual
    (a BS that doesn't balance, or a mis-classified line) is shown, never hidden.

## Why it reconciles by construction

From `Assets = Liabilities + Equity`, `ΔCash = ΔLiabilities + ΔEquity − Δ(non-cash
assets)`. Retained earnings move by the period's net result, so the result lands
in operating and the rest of the equity movement (share issues, dividends) lands
in financing. Grouped into operating / investing / financing, the sub-totals sum
to the actual change in cash — proven in the unit tests (including a dividend
case and a deliberately-unbalanced case that surfaces a residual).

## Shape

- `lib/threestatement-rules.js` — **pure**: `classifyBsLine` (BS line →
  side + cash-flow category, keyword heuristics for a standard UK retail chart),
  `balanceCheck`, `bsMovements`, `indirectCashFlow` (the reconciled bridge).
  Unit-tested in `tests/threestatement.test.mjs` (6 tests).
- `lib/joiin-api.js` — new `balanceSheet()` endpoint (`/report/balance-sheet`,
  eliminated group view), mapped by the existing `mapReportRows`.
- `db/migrations/036_joiin_balance_sheet.sql` — `finance.joiin_bs` (as-at
  balances by section × account × month), mirroring `finance.joiin_pl`.
- `app/api/joiin-refresh/route.js` — `refreshBalanceSheet` pulls the consolidated
  BS per month → `joiin_bs`, additive and best-effort (a bad call never wipes a
  good position; degrades cleanly if migration 036 isn't run).
- `lib/joiin-bs.js` — BS read layer (`getBalanceSheet`, `bsRows`, `bsMonths`).
- `lib/threestatement.js` — assembler (P&L net result + opening/closing BS → the
  linked model).
- `app/finance-os/three-statement/{page,ts-ui}.js` — the screen.
- `lib/nav-registry.js` — **Three-Statement Model** added under Perform.

## Config / migration to run at merge

- **036** — creates `finance.joiin_bs`. Until it is applied (and a Joiin refresh
  run), the P&L tab stands alone and the BS/CF tabs show an honest "awaiting
  Joiin balance-sheet feed" state.
- **One live verification** (as with the P&L when it first went in): the exact
  `/report/balance-sheet` response field names should be confirmed on the first
  real refresh with the live `JOIIN_API_KEY`; `mapReportRows` is written
  defensively against the P&L shape but the BS payload should be eyeballed once.

## Not yet included (fast-follow)

- **Per-entity balance sheet** (mirroring `joiin_pl_entity`) for a by-company BS.
- **Overridable CF classification** — a `cf_map` table so a nominal can be
  re-bucketed (operating/investing/financing) from the UI, replacing the keyword
  defaults; reuses the P&L-format pattern.
- **Forecast balance sheet / cash flow** — extend the driver model with
  working-capital, capex and debt drivers to project all three statements
  forward (today the forecast engine is P&L-to-EBITDA only).
