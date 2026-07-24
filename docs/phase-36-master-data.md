# Phase 36 — Master Data Management (Tier 3.4)

**Tier 3, item 4 ("Leapfrog").** One governed home for the dimensions everything
joins to, with lineage — plus the first fully-mastered dimension beyond Entities
and Users: the **KPI catalogue**.

## What it does

- New **`/data/master`** — the **Master Data hub**. Every governed dimension in
  one view with its row count, when it was last changed and by whom (from the
  audit trail), and a status:
  - **Managed** — has data *and* an in-app editor with a full audit trail
    (Entities, KPI Definitions).
  - **Live** — real data, editor pending (e.g. Scenarios).
  - **Awaiting feed** — no source loaded yet. Shown honestly so the gap is
    visible, not hidden.
- New **`/govern/kpi-definitions`** — the **KPI Definitions master**. The
  governed catalogue behind every dashboard metric (`intelligence.dim_kpi`, 10
  real seeded KPIs): name, calculation, unit, favourable direction, thresholds,
  frequency and owners. ADMIN/FINANCE add/edit; code is immutable once set;
  every change is audited (`objectType: "dim_kpi"`). Mirrors the entity register.
- The nav's **KPI Definitions** item (previously a PLANNED stub) is now **LIVE**
  via `MODULE_FLAGS`, and **Master Data** is added to the Finance Data section.

## Shape

- `lib/masterdata-rules.js` — **pure**: the `DIMENSIONS` catalogue, `statusFor`
  (count + screen → managed / live / awaiting), `summarise`. Unit-tested in
  `tests/masterdata-rules.test.mjs` (3 tests).
- `lib/masterdata.js` — DB layer: per-dimension row count + last-change from
  `governance.audit_event`. All reads guarded (a missing table reads as empty).
- `lib/kpi.js` — `listKpis` / `createKpi` / `updateKpi` (audited).
- `app/api/kpi-definitions/route.js` — create / update (ADMIN/FINANCE).
- `app/govern/kpi-definitions/{page,kpi-admin}.js` — the KPI master screen.
- `app/data/master/page.js` — the hub.
- `lib/nav-registry.js` — Master Data added; KPI Definitions flipped live.

## Lineage

The hub reads provenance from the existing audit trail: every dimension mutation
(entities, KPIs, …) already writes a `governance.audit_event` with an
`object_type` of `dim_<x>`, so "last changed, by whom" needs no new plumbing —
it surfaces what the platform already records. Row counts come straight from the
dimensions.

## Migration to run at merge

- **None.** This phase adds no migration — `intelligence.dim_kpi` and its real
  seed already exist, and the hub only reads existing tables. It works as soon
  as the branch is deployed.

## Not yet included (fast-follow)

- **Chart of Accounts master** — catalogue the account list and, more usefully,
  govern the Joiin-nominal → board-line mapping with an unmapped-nominal
  exception queue (the mapping half already exists in P&L Formats /
  `getMappingReport`).
- **Stores master** — `core.dim_store` has a rich column set but only demo data;
  the real estate lives as `K-*` entities, so a stores master needs a real store
  feed (or a decision to derive stores from store-type entities) first.
- Editors for the remaining dimensions as their feeds land (departments,
  suppliers, customers, franchisees, exchange rates, allocation rules).
