# Driver-based planning engine — design & build plan

Enhances Budget Builder, Forecast Builder and Consolidated P&L so budgets and
forecasts can be prepared separately for **company stores**, **Head Office** and
**franchise stores**, all feeding a governed **Consolidated P&L** — without
replacing the existing customisable P&L templates.

**Governing principle:** the planning engine owns the calculations; the Chart of
Accounts owns the classification; the `pl_format` template owns the presentation.
We build the driver + consolidation engine *beneath* the existing templates.

## Coexistence decisions (agreed)

1. **New `planning.*` schema, coexisting** with the legacy planning tables
   (`finance.plan_*`, `finance.forecast_line`, `finance.dept_budget*`). The live
   `/operate/forecast` screen and dashboards keep working untouched; migration is
   incremental.
2. **Engine owns the PLAN consolidation; Joiin owns the ACTUALS consolidation.**
   The engine produces the consolidated *budget/forecast* (Σ approved scopes +
   approved adjustments); the Joiin board pack (`finance.joiin_boardpack`, with
   real intercompany elimination) remains the consolidated *actuals* source.
   Both are labelled; neither is silently swapped.
3. **Store is the planning unit.** Company-store and franchise-store plans are
   held at individual store × month grain. Legal entity is a *derived* attribute
   from `core.dim_store.entity_id` — never an independent forecasting input.
   Head Office plans by department × cost centre (no store).

## Grain (target)

`scope × store (or HO department) × period × nominal × version × scenario`, with
entity/region derived from the Store Master. Planning scope is one of
`COMPANY_STORE / HEAD_OFFICE / FRANCHISE_STORE / CONSOLIDATION_ADJUSTMENT`.

## Reuse (do not rebuild)

- **P&L templates** — `finance.pl_format.spec` (JSONB per scope) + `renderFormat`
  in `lib/pl-format.js`. The renderer consumes `{ account → { period → amount } }`;
  the engine will feed it that map so all scope/consolidated P&Ls render through
  the existing templates. **Not modified.**
- **Driver maths** — `lib/forecast-rules.js` already implements %-of-sales
  (`VARIABLE_RATE`) and the payroll on-cost chain (holiday/pension/NI). The new
  engine reuses and generalises this rather than duplicating it. On-cost rates
  move from hard-coded constants into the governed Assumption Register.
- **Versioning** — the `finance.forecast_version` lifecycle pattern
  (DRAFT→APPROVED→ARCHIVED) is the model for plan-version locking.
- **AI / Reporting seams** — planning results surface via one new
  `DOMAIN_FETCHERS` domain in `lib/intelligence/retrieval.js` (feeds AI Perspective
  + Finance Buddy) and one `SOURCE_ADAPTERS` key in `lib/reporting/adapters.js`.

## Build phases

- **Phase 1 — foundation (this migration, 055):** Driver Library
  (`planning.driver_definition`), Assumption Register (`planning.driver_assumption`)
  with company→region→entity→store precedence, scenario dimension
  (`planning.scenario`). Pure rules + tests + DB layer. No UI, no live-screen change.
- **Phase 2 — core driver engine:** store sales drivers (footfall × conversion ×
  ATV, direct, hybrid), %-of-sales costs, fixed-cost rules + overrides, payroll
  chain, calculation lineage. Delivered in slices:
  - **2a (done, migration 056):** plan versions, store sales driver inputs, and
    the calculated result grain `planning.plan_line` (keyed by the account NAME
    the templates consume, e.g. `ST: Sales`, with `lineage`). Store net sales =
    footfall × conversion × ATV ± management adjustment; blank drivers fall back
    to the Assumption Register; entity derived from the Store Master; idempotent
    recompute.
  - **2b (next):** cost behaviours — fixed-cost rules + monthly overrides, and
    %-of-sales costs (rate × the version's computed sales).
  - **2c (next):** the payroll chain (basic → holiday → pension → employer NI →
    total), each component posting to its own nominal, rates from the register.
- **Phase 3 — scope planning:** company-store, Head Office, franchise-store plans;
  scope P&Ls via existing templates.
- **Phase 4 — consolidation:** consolidation service + adjustments + reconciliation
  + scope-readiness; consolidated P&L via existing template.
- **Phase 5 — UX:** driver screens, impact preview, validation, submit/approve,
  scenario compare.
- **Phase 6 — AI & reporting:** retrieval domain, reporting adapter, driver &
  scenario commentary.

## Phase 1 objects (migration 055)

| Object | Purpose |
| --- | --- |
| `planning.scenario` | Scenario dimension (BASE / UPSIDE / DOWNSIDE / STRETCH). |
| `planning.driver_definition` | The Driver Library — governed catalogue (code, category, calc_rule, permitted scopes/nominals, approval). Seeded with the starter sales/cost/payroll/franchise drivers. |
| `planning.driver_assumption` | The Assumption Register — a driver's value at a level (COMPANY/REGION/ENTITY/STORE), scenario, period. Most-specific **approved** value wins. Seeded with company-default payroll on-cost rates (holiday 12.07%, pension 3%, employer NI 0% — configurable, thresholds later). |

Resolution and validation are pure functions in `lib/planning-rules.js`
(`resolveAssumption`, `buildStoreSales`, validators); the DB layer is
`lib/planning.js`. Both degrade to empty/no-op before migration 055.
