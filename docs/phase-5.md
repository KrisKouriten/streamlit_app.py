# Phase 5 — Executive Intelligence Hub (HOME)

Delivered 20/07/2026. Scope: rebuild the HOME pillar (`/finance-os/executive`) as an
exception-led executive hub — one screen that opens with the financial position, ranks
everything that needs a person's attention, and shows the health of the three operating
engines (actions, schedule, agents). No new database objects: this phase is a composition
layer over the modules already shipped in Phases 1–4 plus the store-sales dashboards.

## Data layer

`lib/hub.js` — `getHubData()` composes the governed modules rather than querying trading
logic of its own:

| Feed | Source module | Used for |
|---|---|---|
| Revenue, gross margin, LFL, FY plan | `lib/store-sales.js` (`getWindows`, `getPeriodSummary`, `getFyPlanTotal`) | Real hero tiles + forward view |
| KPI RAG readings | `lib/finance-os.js` (`getExecutiveKpis`, `formatKpi`) | RAG rollup + KPI exceptions |
| Cash, facility headroom, inventory | `lib/finance-os.js` view reads | Illustrative hero tiles |
| Weekly schedule stats | `lib/workflow.js` (`getWeekStats`, `mondayOf`) | Operations health + overdue-critical exceptions |
| Agent review queue & exceptions | `lib/agents.js` (`getReviewQueue`, `getRecentExceptions`) | Agent health + AI exceptions |
| Action register & benefits summary | `lib/actions.js` (`getActionSummary`, `listActions`) | Action health + action exceptions |

Each source is wrapped in a `safe()` guard so one empty or failing feed degrades to a
sensible default instead of breaking the whole hub. If the store feed is not loaded,
`getWindows()` returns null and the two trading tiles fall back to "Awaiting store feed".

## Honesty rule (real vs illustrative)

Every figure is tagged with its source and as-at date, because the two feeds are on
different clocks:

- **Real — store feed (as at 30/06/2026):** Revenue YTD and Gross margin YTD, derived
  live from `commercial.fact_store_sales` on the governed definitions. Tagged **STORE FEED**.
- **Illustrative — demo data (as at 31/03/2026):** EBITDA, Cash available, Facility
  headroom and Inventory value. Tagged **ILLUSTRATIVE** and captioned "pending the Xero and
  treasury feeds (Phase 6)". These are honest placeholders, not represented as actuals.

The header carries both as-at dates so the split is never hidden.

## The screen (`app/finance-os/executive/page.js`)

1. **Hero band** — six financial tiles, each a link to its owning dashboard, each showing
   its source chip.
2. **Year to date vs full-year plan** — net sales YTD, vs forecast, FY plan, and a linear
   run-rate projection (explicitly labelled as not weighting H2 seasonality), with a
   progress bar for % of plan delivered.
3. **Needs attention** — the heart of the page. One list, ranked by severity, merging:
   KPI RAG breaches (RED/AMBER), agent outputs awaiting human sign-off (top 5 by impact),
   unresolved agent exceptions, overdue critical/high tasks, and high-value / overdue /
   awaiting-closure actions. Every row deep-links to where a person decides — nothing is
   auto-actioned.
4. **Operating health** — three panels (Actions & benefits, This week's schedule, AI
   agents), each with a link into its pillar.

## Verification (against the production-replica DB, real trading data loaded)

- [x] Hub renders for ADMIN (Kris) and OPS (Farheen); no page errors in either; light and dark themes both clean.
- [x] Real tiles reconcile to the store dashboards (Revenue £18.0m YTD, gross margin 60.8%); illustrative tiles tagged and dated.
- [x] Attention feed correctly ranked: 5 critical agent insights → 4 red KPIs → £446k open action → amber watches; all 10 deep-link targets return 200 when authenticated.
- [x] Operating health matches source screens (1 open action / £451k open value; 9 tasks this week, 2 complete; 8 agent outputs awaiting review).
- [x] `npm test` 30/30 green; production build compiles `/finance-os/executive` as a dynamic route with no errors.

## Not in this phase (follow-ups)
- Phase 6: replace the illustrative finance tiles with the real Xero P&L feed and an
  automated store-sales refresh, and add a true working-capital composite once the balance
  sheet is available.
- A dedicated brand/visual pass (deferred until after Phase 6): introduce a `--red` /
  `--red-bg` CSS variable pair so severity chips theme in dark mode from one place, rather
  than the app-wide hardcoded reds used today.
