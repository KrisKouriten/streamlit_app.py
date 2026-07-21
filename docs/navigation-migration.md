# Navigation migration — target IA (Phase 12)

The target structure (HOME · DASHBOARDS · PLAN · PERFORM · OPERATE · DIGITAL
FINANCE TEAM · FINANCE DATA · GOVERN) is live as a **persistent sidebar**
driven by one registry (`lib/nav-registry.js`). Every module — built or
planned — has a permanent navigation home; planned modules render an honest
"Planned" page at `/module/<slug>` with purpose, breadcrumb and links to the
closest live modules. The ⌘K palette is generated from the same registry.

**No route was renamed or removed.** Every pre-existing screen keeps its URL
and is exposed in the new structure per the protocol below.

## Existing modules — the five-step record

| Existing route | Purpose (as built) | New navigation home(s) | Access preserved | Functionality retained |
|---|---|---|---|---|
| `/finance-os/executive` | Executive Intelligence Hub — orbital HOME, attention feed | HOME → Executive Intelligence Hub | ✓ same route | ✓ unchanged |
| `/dashboards` | Phase-8 dashboards hub (7 cards, provenance badges) | Reachable directly; superseded as a hub by the sidebar's DASHBOARDS group | ✓ same route | ✓ unchanged |
| `/finance-os/management-accounts` | Consolidated P&L on the real feed | DASHBOARDS → Management Accounts **and** PERFORM → Management Accounts | ✓ | ✓ |
| `/finance-os/budget-forecast` | Multi-year plan model (4 tabs, workbook upload) | DASHBOARDS → Budget & Forecast (cross-linked from PLAN → Consolidated P&L planned page) | ✓ | ✓ |
| `/finance-os/store-sales` (+ `/league`, `/store`, `/break-even`) | Trading across every store, governed KPIs | DASHBOARDS → Store Sales & KPI; PERFORM → Store Performance (→ league) | ✓ | ✓ |
| `/finance-os/inventory` | Stock value/ageing/cover (illustrative-badged) | DASHBOARDS → Inventory **and** PERFORM → Inventory | ✓ | ✓ |
| `/finance-os/franchise` | Franchise sales/receivables/credit (illustrative-badged) | DASHBOARDS → Franchise **and** PERFORM → Franchise Performance | ✓ | ✓ |
| `/finance-os/cashflow` | Real cash position by entity | DASHBOARDS → Cash Flow **and** PERFORM → Cash Flow | ✓ | ✓ |
| `/finance-os/fixed-assets` | Asset register (illustrative-badged) | DASHBOARDS → Fixed Assets **and** PERFORM → Fixed Assets | ✓ | ✓ |
| `/operate/month-end` | Per-entity close tasks — finance owner, status, summary | OPERATE → Month-End Close **and** DASHBOARDS → Month-End Close | ✓ | ✓ + owners/summary added |
| `/operate/management-close` | Pre-close checks + reconciliation playbook | OPERATE → Management Accounts Close | ✓ | ✓ |
| `/operate/intercompany` | Three-ledger intercompany tracker | OPERATE → Intercompany (preserved; not in the target list) | ✓ | ✓ |
| `/operate/forecast` | Forecast inputs (stores / HO / franchise) | PLAN → Forecast Builder | ✓ | ✓ |
| `/plan/scenarios` | Scenario levers over forecast inputs | PLAN → Scenario Planning | ✓ | ✓ |
| `/plan` | PLAN hub page | Reachable directly; superseded as a hub by the sidebar | ✓ | ✓ |
| `/perform/my-week` | Personal weekly task list | OPERATE → My Finance Week | ✓ | ✓ |
| `/perform/schedule` | Team schedule + week generation | OPERATE → Finance Team Schedule | ✓ | ✓ |
| `/perform/review` | Task review queue | OPERATE → Task Review Queue (preserved; feeds the planned GOVERN → Approvals) | ✓ | ✓ |
| `/perform/library` | Recurring task templates | OPERATE → Task Library (preserved) | ✓ | ✓ |
| `/ai` (+ `/runs/[id]`, `/agents/[code]`) | Agent Centre — runs, profiles, controls | DIGITAL FINANCE TEAM → Agent Activity | ✓ | ✓ |
| `/ai/review` | Agent output review queue | DIGITAL FINANCE TEAM → Agent Reviews | ✓ | ✓ |
| `/govern/users` | Users & roles admin | GOVERN → Users & Roles | ✓ | ✓ |
| `/govern/entities` | Entity master admin | FINANCE DATA → Entities | ✓ | ✓ |
| `/govern/actions` (+ `[id]`) | Action Centre | OPERATE → Action Centre | ✓ | ✓ |
| `/govern/benefits` | Benefits tracker | DIGITAL FINANCE TEAM → AI Benefits | ✓ | ✓ |
| `/govern` | GOVERN hub page | Reachable directly; superseded as a hub by the sidebar | ✓ | ✓ |
| `/handbook` | In-app SOP | GOVERN → SOP Library | ✓ | ✓ |

## Documented overlaps (not merged — recommendations)

1. **Management Accounts: DASHBOARDS vs PERFORM.** One module, two navigation
   homes (same route). *Recommend:* keep a single module; if PERFORM later needs
   a variance-led "monthly read" distinct from the dashboard, build it as a
   second view of the same data layer, not a second module.
2. **Store Sales & KPI vs Company Store Performance (planned).** League +
   drilldown already cover much of "company store performance". *Recommend:*
   Store Sales & KPI stays canonical for trading; Company Store Performance
   becomes the store-P&L view (EBITDA per store from the forecast/actuals
   grain) — different content, keep separate.
3. **Cash Flow vs Treasury (planned).** Today's cash page carries treasury
   notes. *Recommend:* separate once the treasury feed (facilities, forward
   flows) lands; until then Treasury's planned page points at Cash Flow.
4. **Month-End Close: dashboard vs operate module.** `/operate/month-end`
   (status board) sits under DASHBOARDS; `/operate/management-close`
   (pre-close checks + playbook) under OPERATE. *Recommend:* keep both —
   status vs assurance are different jobs; consider a shared header later.
5. **My Finance Home (planned) vs My Finance Week.** *Recommend:* My Finance
   Home becomes the personal aggregation (tasks + reviews + notifications);
   My Finance Week remains the task workspace inside it.
6. **Approvals (planned) vs Task Review Queue + Agent Reviews.** *Recommend:*
   Approvals becomes one inbox over both existing queues (views of the same
   underlying items), leaving the queues in place.
7. **Master Finance Dashboard (planned) vs Executive Intelligence Hub.**
   *Recommend:* keep separate — the Hub is exception-led (attention);
   the Master dashboard is a full-figure reference view.
8. **Digital Finance Team Dashboard (planned) vs Agent Centre.** *Recommend:*
   dashboard = outcome metrics (accuracy, value, coverage); Agent Centre =
   operational control. Separate.

## Legacy pillar hubs

`/dashboards`, `/plan`, `/operate`, `/perform`, `/govern`, `/ai` remain live
(direct URL, breadcrumb roots). The sidebar makes them optional rather than
the only path — users move module-to-module without returning to a landing
page, per the target behaviour.

## Step 8 — foundation app shell (implemented)

- **AppShell** (`app/app-shell.js`): glass top bar + persistent sidebar
  (drawer under 940px) + ⌘K palette + page-transition content column. Pure
  chrome — no data access or dashboard calculations in navigation components;
  links resolve only through the registry.
- **Shared components** (`app/finance-os/ui.js`): `PageHeader` (title +
  breadcrumb), `Badge`/`ProvenanceBadge` (standard status badges),
  `Stat`/`KpiCard` (the KPI card), `FilterBar`, `Table` (container),
  `EmptyState`, `ErrorState`, `LoadingSkeleton`; route-level `app/loading.js`
  and `app/error.js` (no raw stack traces, migration-aware message).
- **Feature flags** (`MODULE_FLAGS` in `lib/nav-registry.js`): mapping a
  planned slug to a route flips it live across sidebar, palette and pages —
  the safe mechanism for incomplete modules. Until flipped, planned modules
  render professional placeholders (name · purpose · module kind · planned
  milestone · current status · dependencies) — no broken links anywhere.
- **Module kinds** (`MODULE_KINDS`): every module is classified — dashboard
  view (reporting & analysis), planning (data entry & forecasting),
  performance (detailed analysis), operating (finance processes), plus
  master data / governance / digital-finance-team — shown on placeholders
  and derived from section, never from calculations in the nav.

## Phase 14 — section hubs + Procurement + SKU Analysis

- **Clickable section headers.** Each sidebar section header is now a link to
  `/section/<key>` — a mini exec hub listing every subsection as a Live/Planned
  card. The chevron still toggles the group; the label navigates.
- **OPERATE → Procurement** (`/operate/procurement`, migration 016): two
  sections — Miniso purchases and Local purchases. Supplier payment terms set
  the cash-out month (order month-end + terms), so committed spend is bucketed
  by cash-out month against a per-month cash budget the merch team edit inline.
  Pure engine unit-tested; CSV upload; illustrative seed until a real extract
  loads. *Overlaps:* the planned "Purchase Order Tracker" (OPERATE) and
  "Purchase Order & Procurement Dashboard" (DASHBOARDS) — recommend Procurement
  is the operating home; the PO tracker becomes PO raise/approve/match, the
  dashboard a read-only spend view over the same data. Not merged.
- **DASHBOARDS → SKU Analysis** (`/finance-os/sku-analysis`, migration 017):
  three lenses — 80/20 sellers (Pareto A/B/C by TTM revenue), new-SKU
  performance (launched ≤ 6 months), dormant SKUs (no sale ≥ 6 months, stock at
  risk). Pure engine unit-tested; CSV upload; illustrative seed.

## Phase 15 — Forecast Builder: 3-tab store workbook upload

- **PLAN → Forecast Builder** (`/operate/forecast`, migration 018) now ingests a
  3-tab store forecast workbook — **Sales Forecast** (store → entity + monthly
  sales), **Cost Assumptions** (fixed £ with start dates, variable % of sales,
  monthly COGS %), **Labour Seasonality** (Jan–Dec labour % of sales) — and
  builds fixed costs, variable costs and sales into the forecast at **store
  level, rolled up to entity and group**.
- **Amend + add (upsert).** Records upsert on `scope · unit · line · type ·
  month`, so stores/months present are updated, new ones added, and everything
  else left untouched — partial uploads are welcome. The CSV single-line path
  stays for spot edits.
- Migration 018 adds `finance.forecast_line.entity` (store → legal entity). The
  parser is pure (`parseForecastWorkbook` in `lib/forecast-rules.js`) and
  unit-tested; fixed costs expand monthly honouring per-store start dates,
  monthly COGS maps each dated row to its exact month, and labour seasonality
  spreads its Jan–Dec pattern across the horizon.
- *Fast-follow (agreed):* in-grid cell editing on the Forecast Builder.
