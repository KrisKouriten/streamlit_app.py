# Phase 8 — Specialist dashboards, gathered under DASHBOARDS

Revamped the seven specialist dashboards and pulled them out of the old
PLAN / PERFORM / OPERATE tabs into a single **DASHBOARDS** section, in the order
Kris set.

## Navigation
Top nav is now: **HOME · PLAN · DASHBOARDS · OPERATE · WORKFLOW · AI CONTROL TOWER · GOVERN**.
- **PLAN** (`/plan`) — kept as its own tab after HOME, hosting Budget & Forecast
  (its home for nav-highlight); Budget & Forecast is also cross-linked from the
  DASHBOARDS hub. (Migration 011 assigns it to the PLAN pillar.)
- **DASHBOARDS** (`/dashboards`) — new hub listing the seven in order, each card
  carrying a data-provenance badge so "is this real?" is legible before you click in.
- **PERFORM → WORKFLOW** — renamed to reflect what it is: the finance team's cadence
  (My Week, Schedule, Review, Library). Routes unchanged.
- **OPERATE** — now just the operational controls (Month-end close, Intercompany).

## The seven dashboards (in order)
| # | Dashboard | Data | Revamp |
|---|---|---|---|
| 1 | Management Accounts | **Real · Xero** | Structured P&L (revenue → GP → net) with % of revenue and composition bars, above the by-account detail. |
| 2 | Budget & Forecast | **Real · uploaded model** | Aligned to the Dashboards shell (already the richest — plan model + connected actuals). |
| 3 | Cash Flow | **Real · Xero** | Added a per-entity cash breakdown with bars and reconciliation chips. |
| 4 | Store Sales & KPI | **Real · governed feed** | The reference implementation; crumbs aligned. |
| 5 | Inventory | Illustrative | Honest scaffold + ageing composition (under-90 / 90–180 / over-180). |
| 6 | Franchise | Illustrative | Honest scaffold + collection % and receivables-at-risk. |
| 7 | Fixed Assets | Illustrative | Honest scaffold + category rollup and remaining-value ratio. |

Dashboards 5–7 read real Postgres tables that currently hold illustrative seed
data; they carry a prominent amber **Illustrative** banner and a note describing how
a real feed lands. Dedicated CSV/manual importers for these three (like Budget &
Forecast / Intercompany) are a focused follow-up once the source models are shared —
the fact tables are heterogeneous star schemas (inventory is at product×store grain),
so a faithful importer is per-domain work, not a one-liner.

## Shared kit
Extended `app/finance-os/ui.js` with `Badge`, `ProvenanceBadge`, `Bar` (inline
proportional bar) and `IllustrativeBanner`, so real and illustrative dashboards read
as one family. Breadcrumb root now points at `/dashboards`.

## Migration
`db/migrations/010_dashboards_pillar.sql` — reassigns the seven registry rows to the
`DASHBOARDS` pillar with Kris's display order. Idempotent. The DASHBOARDS hub lists
the seven from code, so the nav works without it; 010 only stops the OPERATE / WORKFLOW
hub pages from listing the analytical dashboards as their own cards.

## Verification
- `npm run build` clean; `npm test` 45/45.
- Browser-verified (dark + light): new nav, `/dashboards` hub, all seven dashboards,
  `/plan` redirect, WORKFLOW rename — zero page errors. Management Accounts net result
  −£25,913 matches the reconciled Xero figure.
