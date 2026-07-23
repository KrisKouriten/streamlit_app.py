# Miniso UK Finance Operating System — Standard Operating Procedure

**Version 1.3 · 21/07/2026 · Owner: Finance (Miniso UK)**

> Also available in-app: **Govern → SOP Library** (`/handbook`) renders this for the
> signed-in team.

This is the operating manual for the Finance Operating System (FOS): what it is, who
does what, the weekly and monthly rhythm, how each module works, how the data feeds
are kept fresh, and how the governance controls hold. It reflects the platform as
delivered through Phase 15 — the eight-section navigation, the Joiin consolidation
feed, the management-accounts and month-end close controls, Procurement, SKU
Analysis, and the store-level Forecast Builder.

> **Entity note.** In this document and everywhere in the app, the business is
> "Miniso UK". The underlying legal entities (e.g. *Kouriten Cambridge Limited*,
> *Kouriten Limited t/a Miniso UK*) are named precisely only where a document is
> legal, statutory, or a connected-system identifier (bank, HMRC, Companies House,
> Xero/Joiin org names, the store→entity forecast hierarchy).

---

## Contents
1. Purpose & what the FOS is
2. Access, roles & permissions
3. Navigation
4. The operating rhythm (daily / weekly / monthly / quarterly)
5. Module procedures
6. Data feeds & refresh
7. Governance & controls
8. Roles & responsibilities
9. Environment, deployment & migrations
10. Extending the system
11. Troubleshooting runbook
12. Security & data handling
13. Glossary

---

## 1. Purpose & what the FOS is

The FOS is Miniso UK's single finance workspace. It brings the numbers (store
trading, statutory finance), the plan (budgets, forecasts, scenarios), the work (a
governed weekly schedule and the month-end close), the assistance (reviewable AI
agents), and the follow-through (an action & benefits register) into one place, under
one audit trail and one role model.

Design principles that everything else follows:
- **Completion is not approval.** Doing the work and signing it off are always
  separate events, done by different rights.
- **Nothing AI does is auto-actioned.** Every agent output is reviewed by a person
  before it becomes an insight or an action.
- **Honesty about sources.** Every figure is tagged real vs illustrative, with its
  source and as-at date. Partial data is shown as partial.
- **Everything is audited.** Every state change writes an audit event.

---

## 2. Access, roles & permissions

Sign in at the app URL with your Miniso UK email and password. Sessions last 12
hours; **Sign out** is in the top-right of every screen, beside your name. There is
no self-registration — an ADMIN creates accounts under **GOVERN → Users & roles**.

**Roles** (a user can hold more than one; new users default to FINANCE):

| Role | What it can do beyond viewing |
|---|---|
| **ADMIN** | Everything, plus manage users, roles & entities. |
| **FINANCE** | Run agents; approve task reviews; approve action closure; validate benefits; generate the weekly schedule; load/amend forecast inputs; manage entities. |
| **EXEC** | Approve action closure; validate benefits. |
| **OPS** | Do and complete assigned work; raise actions. Cannot approve closure or validate benefits. |

**Key permission rules:**
- **Run an AI agent:** ADMIN or FINANCE.
- **Approve a task at review:** the task's reviewer, or a manager (ADMIN/FINANCE).
- **Approve action closure / validate a benefit:** ADMIN, FINANCE or EXEC — and,
  as good practice, not the sole person who did the work.
- **Load forecast inputs / procurement budgets:** ADMIN or FINANCE.
- **Manage users:** ADMIN only.

Everyone signed in can view all dashboards; the controls above gate *actions*, not
*visibility*.

---

## 3. Navigation

Navigation is a **persistent sidebar** on every screen — eight sections, every
module one click away, no landing pages required:

**HOME · DASHBOARDS · PLAN · PERFORM · OPERATE · DIGITAL FINANCE TEAM ·
FINANCE DATA · GOVERN.**

The sidebar, the ⌘K palette and the planned-module pages are all driven by one
registry (`lib/nav-registry.js`) — a single source of truth, so nothing drifts.
Each **section header is itself a link** to a mini exec hub (`/section/<key>`) that
lists every subsection as a Live or Planned card; the chevron beside it still
toggles the group open/closed.

Modules not yet built are marked **soon** and open an honest **Planned** page
(`/module/<slug>`) describing their purpose, module kind, milestone, dependencies and
the closest live modules — no broken links anywhere. Flipping a slug live in
`MODULE_FLAGS` makes it appear everywhere at once. The full structure, the
route-preservation record and the documented overlaps live in
`docs/navigation-migration.md`.

| Section | What lives here (live modules in **bold**) |
|---|---|
| **HOME** | **Executive Intelligence Hub** (position & attention); My Finance Home, Notifications, Global Search (⌘K). |
| **DASHBOARDS** | **Management Accounts · Budget & Forecast · Store Sales & KPI · Franchise · Inventory · SKU Analysis · Cash Flow · Fixed Assets · Month-End Close** (status board); plus planned reference dashboards (Master, Company Store Performance, Wholesale, Treasury, PO & Procurement, Department/Project Budget, WAC, Digital Finance Team, Data Quality, Controls). |
| **PLAN** | **Forecast Builder · Scenario Planning**; planned Budget Builder, Store/Wholesale/Franchise planning, Department/Project budgets, Consolidated P&L. |
| **PERFORM** | **Management Accounts · Store Performance (league) · Franchise · Inventory · Cash Flow · Fixed Assets** — the against-plan read; planned Wholesale/Treasury/Procurement performance. |
| **OPERATE** | **My Finance Week · Finance Team Schedule · Month-End Close · Management Accounts Close · Procurement · Action Centre · Intercompany · Task Review Queue · Task Library**; planned PO Tracker, WAC, Finance Projects. |
| **DIGITAL FINANCE TEAM** | **Agent Activity · Agent Reviews · AI Benefits**; the seven planned "master" agents (Chief Finance Intelligence, FP&A, Finance Operations, Commercial, Governance, Data, Executive Reporting) and Agent Exceptions. |
| **FINANCE DATA** | **Entities** (the legal-entity register); planned masters — Chart of Accounts, Stores, Departments, Projects, Cost Centres, Suppliers, Customers, Franchisees, Budget/Forecast Versions, Exchange Rates, KPI Definitions, Allocation Rules. |
| **GOVERN** | **Users & Roles · SOP Library** (this Handbook); planned Permissions, Approvals (one inbox over the review queues), Controls, Data Quality, Audit Trail, System Settings. |

The **legacy section hubs** (`/dashboards`, `/plan`, `/operate`, `/perform`,
`/govern`, `/ai`) remain reachable at their original routes as breadcrumb roots —
the sidebar just makes them optional.

**Start every day at HOME.** It is exception-led: it surfaces what needs a person's
decision and links straight to where that decision is made.

**Go anywhere with ⌘K** (Ctrl K on Windows), or the **Search** button in the nav:
the command palette reaches every dashboard, control and action — including theme
switch and sign out — without touching the mouse.

---

## 4. The operating rhythm

### Daily
- **Check HOME → "Needs attention".** It is ranked by severity and merges: KPI
  breaches, AI outputs awaiting sign-off, agent exceptions, overdue critical tasks,
  and high-value / overdue / awaiting-closure actions. Each row links to where you
  act. Clear the critical items first.
- **Clear the AI review queue** (Digital Finance Team → Agent Reviews) so nothing
  material sits unreviewed.

### Weekly (Monday)
1. **Generate the week** — OPERATE → Finance Team Schedule → *Generate week*. This
   creates dated task instances from the active templates (idempotent — safe to
   click twice).
2. **Team picks up work** — each person works their tasks in OPERATE → My Finance
   Week (assign → in progress → ready for review / complete).
3. **Reviewers approve** — OPERATE → Task Review Queue clears tasks that require a
   second pair of eyes. Approval, not completion, moves a task to COMPLETE.
4. **Run the store agents** — Digital Finance Team → Agent Activity → run *Store
   Priorities* and *Data Quality*; review their outputs.
5. **Review store trading** — DASHBOARDS → Store Sales & KPI (executive view,
   league, drilldown, break-even) once the weekly store data is loaded.

### Monthly
- **Management accounts close** — OPERATE → Management Accounts Close: run the
  pre-close checks (completeness/accrual, variable & fixed drift, sign) and work the
  reconciliation playbook before the numbers are relied on.
- **Management accounts** — DASHBOARDS / PERFORM → Management Accounts, once the
  month's Joiin actuals are loaded (see §6).
- **Month-end close** — OPERATE → Month-End Close: every entity's close tasks with a
  named **finance owner** and Open/Done status, under a summary strip showing overall
  progress and per-stage rollups.
- **Procurement budget** — OPERATE → Procurement: reconcile committed Miniso & local
  spend (bucketed by cash-out month from supplier terms) against the per-month cash
  budget.
- **Benefits validation** — Digital Finance Team → AI Benefits / GOVERN: validate
  realised value on delivered actions (ADMIN/FINANCE/EXEC).
- **Action review** — OPERATE → Action Centre: chase overdue, approve closures.

### Quarterly / planning cycle
- **Refresh the forecast** — PLAN → Forecast Builder: upload the latest 3-tab store
  workbook (see §5.7); flex it in **Scenario Planning**.
- Review agent performance and controls (Digital Finance Team), refresh task
  templates (OPERATE → Task Library), and review roles (GOVERN → Users).

---

## 5. Module procedures

### 5.1 Executive Intelligence Hub (HOME)
Two truths, kept visibly separate by source chips so they're never confused:
- **Trading — all stores** (green *Store · all* chip): revenue & gross margin from
  the store feed.
- **Statutory finance — connected entities** (blue feed chip): revenue, gross
  profit, net result, cash from the real consolidation feed (Joiin, with Xero as
  fallback), across the entities currently connected (the header states how many and
  as at when).

Below the tiles: a year-to-date-vs-plan strip, the **Needs attention** feed, and
three operating-health panels (Actions & benefits, this week's schedule, AI agents).
The hub never auto-actions — it points.

### 5.2 Store Sales & KPIs (DASHBOARDS)
Four screens: executive view, store league, store drilldown, break-even. Governed
definitions (mirroring the finance Excel model, applied consistently everywhere):
- Only **valid trading days** are counted; only **real stores** (an operator is set)
  are included; demo rows are ignored.
- "This week" = the latest complete Monday–Sunday week in the data. Prior year =
  the same calendar dates − 365 days.
- **ATV** = net sales ÷ net transactions. **Conversion** = net transactions ÷
  footfall. **Like-for-like** = stores trading in both years with 4+ weeks' history
  before the window.

### 5.3 Finance dashboards on the real feed (DASHBOARDS / PERFORM)
- **Management Accounts** — the real consolidated P&L by account across connected
  entities, with the scope banner. Budget/forecast comparatives are blank until a
  real plan is loaded (no illustrative numbers).
- **Budget & Forecast** — the multi-year plan model with workbook upload.
- **Cash Flow & Treasury** — real reconciled cash; bank facilities and forward
  cashflow await the treasury feed.
- **Franchise · Inventory · Fixed Assets** — carry an *illustrative* badge until
  their real extracts load; the badge and as-at date make the provenance explicit.

Every finance screen carries the feed banner stating which entities are live and as
at when.

### 5.4 SKU Analysis (DASHBOARDS)
Three lenses over a per-SKU metrics table (CSV-uploadable; illustrative seed until a
real extract lands): **80/20 sellers** (Pareto A/B/C by trailing-twelve-month
revenue), **new-SKU performance** (launched ≤ 6 months, revenue since launch), and
**dormant SKUs** (no sale in ≥ 6 months, with stock value at risk).

### 5.5 Weekly Finance Schedule (OPERATE)
A controlled task workflow. **11 statuses**; the important rule is that an assignee
can only take a task to *Ready for review* (or *Complete* where no review is
required) — **only a reviewer's decision** moves it to Complete or Returned.
- **My Finance Week** — your tasks; claim available ones, progress your own.
- **Finance Team Schedule** — the whole team's week and capacity; generate the week
  here.
- **Task Review Queue** — the queue of tasks waiting for a reviewer.
- **Task Library** — the task templates (weekly & monthly) that generate the work.
Overdue tasks escalate automatically and surface on HOME.

### 5.6 The two closes (OPERATE)
- **Month-End Close** (`/operate/month-end`) — a status board: every entity's close
  tasks with an assignable **finance owner** and Open/Done chips, under a **summary
  strip** (overall status + per-stage rollups). This is the single place month-end
  work is tracked; the standalone legacy tracker is retired.
- **Management Accounts Close** (`/operate/management-close`) — assurance before the
  numbers are relied on: **pre-close checks** (completeness/accrual, variable & fixed
  cost drift vs the forecast, sign) each with a **confirm · correct · explain**
  decision, plus a reference model and an 18-step reconciliation playbook. Status
  (the board) and assurance (the checks) are deliberately different jobs.

### 5.7 Forecast Builder (PLAN)
The store-level forecast is built here from a **3-tab store workbook** (upload via
*Upload forecast workbook (3 tabs)*):
- **Sales Forecast** — each store, the **entity** it rolls up to, and monthly sales.
- **Cost Assumptions** — fixed costs in £ (expanded to monthly lines, honouring each
  store's start date), variable costs as a % of sales, and a monthly COGS % grid.
- **Labour Seasonality** — labour as a % of sales, Jan–Dec, spread across the horizon.

The workings compute per scope — **STORES / HEAD_OFFICE / FRANCHISE** — as
sales − variable − fixed = EBITDA, and consolidate **store → entity → group**.
Variable costs are each store's own rates × its forecast sales; a month-specific rate
(seasonal COGS, labour) overrides the constant default for that month.

Upload is **amend + add (upsert)**: records key on
`scope · unit · line · type · month`, so stores and months present in the file are
updated, new ones added, and everything else left untouched — **partial uploads are
welcome**. A CSV single-line path stays for spot edits. *(Fast-follow: in-grid cell
editing.)*

### 5.8 Scenario Planning (PLAN)
Upside / base / downside levers over the forecast inputs — flex sales, variable and
fixed by a percentage and read the EBITDA delta vs base across scopes. Scenarios are
saved and named; they never alter the underlying inputs.

### 5.9 Procurement (OPERATE)
Two sections — **Miniso purchases** and **Local purchases**. Supplier **payment
terms** set the cash-out month (order month-end + terms), so committed spend is
bucketed by the month cash actually leaves against a per-month **cash budget** the
merch team edit inline. CSV-uploadable; illustrative seed until a real extract loads.

### 5.10 Intercompany (OPERATE)
A three-ledger tracker — cash, inventory & recharges, disbursements — across the
group's entities, with CSV upload and manual entry. UK dates (DD/MM/YYYY) normalise
to ISO on load.

### 5.11 Finance Agent Control Centre (DIGITAL FINANCE TEAM)
AI agents assist; they never act. Two agents ship today: **Store Priorities**
(flags stores needing attention vs last year) and **Data Quality** (freshness,
footfall coverage, invalid days, overdue critical tasks); the seven "master" agents
are planned.
- **Guardrails are structural, not prompt-based:** agents can only *read* (SELECT).
  There is no code path for posting journals, moving money, changing forecasts or
  sending communications.
- **Run → review lifecycle:** a run produces outputs; **material** outputs (by the
  agent's £ materiality threshold) require human review. In Agent Reviews, a reviewer
  **approves / amends / rejects** each output. Approve or amend turns it into an
  insight; optionally "create action" sends it to the Action Centre tagged AI_AGENT
  and linked to the run. Nothing reaches an action without that sign-off.

### 5.12 Action Centre & Benefits (OPERATE / DIGITAL FINANCE TEAM)
One register for actions from every source (dashboard, month-end, weekly task, AI
agent, board, control, audit, manual).
- **Lifecycle:** OPEN → IN_PROGRESS → COMPLETE → CLOSED, plus CANCELLED and OVERDUE.
  **COMPLETE** = the owner says the work is done. **CLOSED** = closure *approved* by
  ADMIN/FINANCE/EXEC — a separate event. Add progress notes and evidence throughout.
- **Benefits:** an action with an expected value auto-creates a **benefit
  opportunity**. Record **realised** value (a measurement), then **validate** it
  (ADMIN/FINANCE/EXEC) → the opportunity becomes VALIDATED. The Benefits tracker
  splits expected / realised / validated by **AI vs human** origin.

---

## 6. Data feeds & refresh

The deployed app reads only its database. Feeds are loaded into that database; the
app never calls an external system at runtime.

### 6.1 Store sales (trading)
Loaded from the store data export. To refresh: regenerate the load SQL from the
latest export and run it in the database (each load replaces the slice it covers and
writes a `data_refresh_log` entry). Freshness tolerance is **9 days** — the Data
Quality agent flags older data, and HOME shows it stale.

### 6.2 Consolidation feed — Joiin (statutory)
**Joiin is the connector** for consolidated statutory finance (26 companies, with
eliminations), replacing the direct Xero connection. The app selects the active
source with `getActiveSource()`, which **prefers Joiin rows and falls back to Xero**
where a Joiin figure isn't present — so nothing regresses during the switch.

Because the app can't call the source at runtime, a refresh is done in a Claude
session (or a future scheduled routine):
1. **Pull** the consolidated P&L and cash position from Joiin (or Xero for a single
   org).
2. **Map & reconcile** through the mapping rules — income positive, costs negative;
   the mapper **reconciles to the source's own section totals and refuses the load if
   a penny is lost**. Unmapped accounts fall to Central Overheads and are reported.
3. **Ingest** the normalized extract (tagged with its `source_system`), idempotent
   per entity/period; a refresh-log entry and audit event are written.
4. Real figures are loaded internally only and are **not committed to the repo**.

**Reconciliation is the gate.** A load is only accepted when its account totals match
the source report exactly.

### 6.3 Adding an entity (consolidation)
Miniso UK spans several legal entities (managed under **FINANCE DATA → Entities** —
display name, legal name, type and connection status). The dashboards consolidate
whatever is connected. To add one: create/confirm it under Entities, connect its org,
then load it as above. The dashboards consolidate it automatically and the scope
banner updates.

### 6.4 Forecast inputs (planning)
Loaded through **PLAN → Forecast Builder** from the 3-tab store workbook (§5.7), or
the CSV path for single lines. Upsert on `scope · unit · line · type · month`; a
partial workbook amends only what it covers. Forecast lines carry the store→entity
hierarchy so the plan consolidates store → entity → group.

### 6.5 Procurement & SKU
Both accept a CSV extract and carry an **illustrative seed** until the real data is
uploaded, clearly badged as illustrative in the meantime.

---

## 7. Governance & controls

- **Separation of duties.** Task completion vs reviewer approval; action completion
  vs closure approval; benefit realised vs validated — always different events, and
  closure/validation require ADMIN/FINANCE/EXEC.
- **AI guardrails.** Structural read-only access; material outputs always reviewed;
  approve/amend/reject recorded; the insight→action link preserved end to end.
- **Close assurance.** The management-accounts pre-close checks give a
  confirm/correct/explain decision on completeness, cost drift and sign before the
  month is relied on; the month-end status board tracks who owns each entity's close.
- **Audit trail.** Every state change (logins, task moves, agent runs & reviews,
  action transitions, closures, benefit validations, forecast loads, data loads)
  writes a `governance.audit_event`. This is the record of who did what, when.
- **Materiality.** Agent outputs above the agent's £ threshold require review;
  below-threshold, non-report outputs still route to review by default.
- **Freshness.** The Data Quality agent and HOME surface stale or incomplete feeds.

---

## 8. Roles & responsibilities

Responsibilities are assigned by **role** (above) and by the owner/reviewer fields
configured on each task template, dashboard, close task and agent. As a guide:

| Activity | Accountable | Does the work |
|---|---|---|
| Weekly schedule generated & staffed | Finance lead (FINANCE) | Finance team |
| Task review & sign-off | Named reviewer / manager | — |
| Month-end close per entity | Named finance owner | Finance team |
| Management-accounts pre-close checks | Finance lead (FINANCE) | Finance team |
| Agent runs & output review | FINANCE | FINANCE |
| Action closure approval | ADMIN/FINANCE/EXEC | Action owner completes |
| Benefit validation | ADMIN/FINANCE/EXEC | Owner records realised |
| Forecast inputs & scenarios | FINANCE | Finance / FP&A |
| Store data & consolidation refresh | Finance lead | Finance / scheduled routine |
| User & role administration | ADMIN | — |

Specific owners are configured in the app (task templates, close tasks, dashboard
registry, agent registry) and can be changed there without code.

---

## 9. Environment, deployment & migrations

- **Hosting:** the app runs on Vercel; the database is Neon (PostgreSQL 16). Local
  development runs against a replica database.
- **Environment variables:** `DATABASE_URL` (the connection string; the app also
  accepts Vercel's prefixed names) and `SESSION_SECRET` (a long random string).
- **Deploys:** pushing to `main` triggers a Vercel deploy; pull requests get a
  preview deploy.
- **Migrations:** SQL files in `db/migrations/`, each idempotent with a rollback
  header (`BEGIN`/`COMMIT`, `ADD COLUMN IF NOT EXISTS`, seed-only-if-empty guards).
  Run them **in ascending order** in Neon; all are safe to re-run. A screen whose
  table isn't present yet renders a "run migration NNN" setup card rather than
  crashing — so a missed migration is a prompt, not an outage.
- **Current migrations (001–018):** 001 roles & audit · 002 navigation & definitions ·
  003 workflow · 004 agents · 005 action centre · 006 Xero finance feed · 007
  entities · 008 intercompany · 009 budget & forecast · 010 dashboards section · 011
  restore plan section · 012 management-accounts close · 013 forecast inputs &
  scenarios · 014 Joiin feed · 015 month-end task owner · 016 procurement · 017 SKU
  analysis · 018 forecast store→entity.

---

## 10. Extending the system

- **New navigation module:** add an item to `NAV_SECTIONS` in `lib/nav-registry.js`;
  it appears in the sidebar, the ⌘K palette and its section hub automatically. A
  planned item renders a professional placeholder until you flip its slug live in
  `MODULE_FLAGS`.
- **New task template:** add it in the workflow templates; it starts generating with
  the next week.
- **New agent:** register it, add a read-only implementation behind the runner (it
  inherits the SELECT-only guardrail and the review lifecycle), and set its
  materiality threshold.
- **New action source:** already supported by the source taxonomy — just raise the
  action with that source.
- **New finance entity:** see §6.3.

Keep the pattern: extend existing tables, keep rules pure and unit-tested
(`*-rules.js` with `node:test`), write an idempotent migration, verify on a replica,
then ship.

---

## 11. Troubleshooting runbook

| Symptom | Likely cause | Fix |
|---|---|---|
| A screen shows a "run migration NNN" setup card | That migration hasn't run in this database | Run the named migration in Neon (§9); refresh. |
| A dashboard says "Awaiting … feed" | That feed isn't loaded in this database | Run the relevant load (§6). |
| A dashboard shows an *illustrative* badge | No real extract loaded yet (Franchise, Inventory, Fixed Assets, Procurement, SKU) | Upload the real data; the badge clears. |
| HOME shows data as stale | Store load older than 9 days | Refresh the store feed. |
| Finance figures look too small / one entity | Only one org is connected | Expected — connect more entities (§6.3). The scope banner explains. |
| A consolidation load is refused | Totals don't reconcile to the source | Investigate the source; the mapper is protecting you from a bad load. |
| Forecast upload "not loaded" | No readable rows found in the workbook | Check the three tab names & headers; partial uploads are fine but need at least one valid row. |
| "Not signed in" / redirect to login | Session expired (12h) or `SESSION_SECRET` unset | Sign in again; check the env var. |
| Migration errors | Run out of order | Run 001→018 in order; all are safe to re-run. |
| A user can't approve closure | They lack ADMIN/FINANCE/EXEC | Grant the role in GOVERN → Users (ADMIN). |

---

## 12. Security & data handling

- **Naming:** "Miniso UK" in all outputs; legal entity names only in legal/statutory
  or connected-system contexts (bank, HMRC, Companies House, Xero/Joiin org names, and
  the store→entity forecast hierarchy).
- **No personal data** in exports or shared outputs (home addresses, DOB, NI, bank
  details, salary, health, disciplinary detail). Employee names in ordinary business
  context are fine.
- **Real financial data stays internal.** Entity-level statutory figures (P&L,
  balance sheet, cash) are for internal working use; do not produce share-ready or
  external summaries without explicit confirmation and human review.
- **Escalations** (do not draft/share without sign-off): external regulator
  correspondence, investor/board materials, or anything that could be inside
  information for the listed parent group.
- **Load files with real figures** are delivered to finance directly and kept out of
  the repository.

---

## 13. Glossary

- **ATV** — average transaction value = net sales ÷ net transactions.
- **LFL (like-for-like)** — stores trading in both the current and prior-year
  windows with 4+ weeks' prior history.
- **Scope** — a forecast dimension: **STORES**, **HEAD_OFFICE** or **FRANCHISE**.
- **Store → entity → group** — the forecast hierarchy: each store rolls up to the
  legal entity that owns it, and entities consolidate to the group.
- **Upsert grain** — forecast lines key on `scope · unit · line · type · month`; an
  upload amends matching lines and adds the rest.
- **Material output** — an AI output above the agent's £ threshold; always reviewed.
- **Completion vs closure** — completion is the owner saying work is done; closure is
  a separate approval by ADMIN/FINANCE/EXEC.
- **Benefit opportunity → measurement → validation** — expected value → realised
  value recorded → value validated by finance.
- **Connected entity** — an organisation whose actuals are loaded and consolidated
  into the finance dashboards.
- **Joiin** — the consolidation connector (26 companies, eliminations); the active
  source resolver prefers Joiin and falls back to Xero.
- **source_system** — the tag distinguishing real feeds (`JOIIN`, `XERO`, the store
  load) from demo data (`DEMO`); real dashboards read only real sources.
- **Freshness / `data_refresh_log`** — the record of when each feed last loaded;
  drives the staleness warnings.

---

*Keep this SOP in step with the platform. When a phase or feed changes, update the
relevant section and bump the version and date above.*
