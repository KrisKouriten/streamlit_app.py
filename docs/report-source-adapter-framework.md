# Report Source Adapter Framework

_Miniso UK Finance OS. How a report section pulls governed data —
`lib/reporting/adapters.js` (CR §30)._

## Principle

One controlled way for a report component to pull governed data from a Finance OS
module, so report templates never couple to a dashboard's implementation. Every
adapter returns the **same envelope**; figures come from the **same governed
services** the dashboards and the Intelligence Layer use, so a report reconciles
to its source. An unbuilt domain returns an honest "awaiting feed" — never an
invented figure.

## The envelope

Every adapter returns this shape (`envelope()` in `adapters.js`):

```
{
  key, label,
  ready,                // true only when governed figures were resolved
  reason,               // human-readable "why not ready", else null
  kpis: [{ label, value, unit }],
  table: { columns, rows } | null,
  metadata: {
    sourceRoute,        // the governed dashboard this reconciles to
    dataThrough,        // freshness (ISO), from the governed source
    provenance,         // "feed" | "illustrative" | "awaiting"
    approvalStatus,     // "GOVERNED" | "WORKING_FORECAST"
    validationStatus,   // "OK" | "MISSING"
    filters
  },
  warnings: [],         // e.g. "illustrative seed — not a real feed yet"
  flags: {}
}
```

`ready`, `reason` and `metadata.validationStatus` drive the section's
`data_status` in `resolveReport` (READY / PARTIAL / MISSING), which in turn feeds
the validation checklist and the "requiring attention" feed.

## The registry

`SOURCE_ADAPTERS` is a keyed registry; `SOURCE_KEYS` and `hasAdapter(key)` expose
it. Templates reference an adapter by its `source_key`
(e.g. `store_sales`, `management_accounts`, `franchise`, `actions`).

`resolveSource(sourceKey, { scope, filters })` looks the adapter up and runs it.
It **never throws**: an unknown key, no key, or a failing adapter all degrade to a
not-ready envelope so a report page renders an honest "awaiting" state rather than
crashing.

## Three kinds of adapter

### 1. Domain-backed (`domainAdapter`)

Delegates to the governed retrieval layer:
`gatherEvidence(domains, scope)` (`lib/intelligence/retrieval.js`) — the same
permission-aware, scope-checked path the Intelligence Layer uses. The returned
`facts` become KPIs, `sources[0].route` becomes the source route, `dataThrough`
comes from the first governed source, and `warnings`/`flags` pass through. If the
evidence is marked missing and no facts came back, the envelope is not-ready with
an "Awaiting … data" reason. A working forecast flag
(`flags.hasUnapprovedForecast`) sets `approvalStatus: "WORKING_FORECAST"` so the
report never presents a working number as approved.

Registered domain-backed adapters include: `executive_hub`, `store_sales`,
`management_accounts`, `cash`, `forecast`, `sku`, `close`, `projects`.

### 2. Service-backed (bespoke)

A few adapters call a governed service directly to build a real table plus KPIs:

- **`store_ranking`** — a cross-store league table via `getStoreLeague`. Withheld
  unless the session scope permits a cross-store comparison (`scope.unrestricted`);
  otherwise an honest "not cleared for a cross-store comparison" reason (CR §9).
- **`franchise`** — invoiced sales, overdue receivables and a franchisee table
  from `getFranchise` (`commercial.fact_franchise`).
- **`inventory`** — stock value and cover weeks from `getInventoryHealth`.
- **`actions`** — the governed Action Centre: open/overdue counts, expected value
  and an action table from `getActionSummary` / `listActions`.

Where a service is an illustrative seed rather than a live load, the adapter sets
`provenance: "illustrative"` and adds a warning so the label is never hidden.

### 3. Awaiting (`awaitingAdapter`)

For a domain with no feed yet — **honesty over fabrication**. It returns
`ready:false`, `provenance:"awaiting"`, `validationStatus:"MISSING"` and a clear
reason. The three awaiting adapters in this release:

| Key | Route | Reason |
|---|---|---|
| `treasury` | `/finance-os/cashflow` | Awaiting a bank-facility / forward-cash feed — not connected yet. |
| `wholesale` | — | Awaiting a wholesale income feed — not connected yet. |
| `purchase_orders` | `/operate/procurement` | Awaiting a purchase-order feed — not connected yet. |

A section bound to an awaiting adapter resolves to `data_status: "MISSING"`, shows
its reason on every surface, and — if the section is mandatory — will fail
validation, so an incomplete report cannot be issued as final.

## How a report reconciles to source

Because a domain-backed adapter calls the very same governed calculation service
as the corresponding dashboard, a KPI in a report equals the KPI on its
dashboard, and the envelope carries the dashboard's `sourceRoute` and
`dataThrough` for the footer. AI commentary is then drafted over **only** those
resolved facts (see `docs/report-ai-commentary-framework.md`), so the narrative
reconciles to the figures on the page.
