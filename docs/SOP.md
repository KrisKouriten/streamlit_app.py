# Miniso UK Finance Operating System — Standard Operating Procedure

**Version 1.4 · 24/07/2026 · Owner: Finance (Miniso UK)**

> Also available in-app: **Govern → SOP Library** (`/handbook`) renders this for the
> signed-in team.

This is the operating manual for the Finance Operating System (FOS): what it is, who
does what, the weekly and monthly rhythm, how each module works, **how every input
maps through a refresh to an output**, and how the governance controls hold. It
reflects the platform as delivered through Tier 3 — the eight-section navigation, the
**app-side Joiin consolidation feed** (direct API refresh with a monthly cron), the
four-scope **board packs**, the **three-statement model** (linked P&L, Balance Sheet
and Cash Flow), the management-accounts and month-end **close** controls (including
the Close Cockpit), Procurement, SKU Analysis, the store-level Forecast Builder, the
**Report Builder**, **Master Data Management**, and the first **LLM commentary**
agent.

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
5. Module procedures — including the numbered month-end close (**5.6**), **5.13 Building the board deck**, **5.14 Building the trade deck** and **5.15 Corporate Reporting Centre**
6. Data feeds, refresh & how it all maps (the lineage map)
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
no self-registration — an ADMIN creates accounts under **GOVERN → Users, Roles &
Permissions**. That one screen carries three things: **Users & roles** (who can
sign in, their role, their department), **Department sign-off**, and **Access**.

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

**Department sign-off.** Each department has one or more named approvers — the
people who sign off that department's budgets and purchase orders (e.g. Operations
= its department head; Finance can hold more than one). Set them under **GOVERN →
Users, Roles & Permissions → Department sign-off**; a department may have several.

**Access (who sees what).** By default everyone signed in sees every navigation
section. An ADMIN can narrow that per department under **Users, Roles & Permissions
→ Access**: pick a department, then tick the navigation headers and sub-headers it
should see. Unticking a header hides the whole section; with the header ticked you
can still hide individual sub-headers. Admins always see everything regardless.
The controls in the table above gate *actions*; Access gates *visibility* per
department, so the two work together.

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

**Every hub leads with a hero and page intelligence.** Each section and pillar hub
now opens with a **hero KPI band** — the headline figures for that area (drawn from
the same governed feeds as the Executive Hub, each tile source-chipped and linking
to its owning module), so a page tells you something before you navigate. Beneath it
sits a standard **page-intelligence strip**: **Ask Finance Buddy**, and — on data
pages — **AI Perspective**, **Add to Report** and a **Related** rail of onward links.
Hero tiles degrade to "Awaiting feed" rather than inventing a number.

Modules not yet built are marked **soon** and open an honest **Planned** page
(`/module/<slug>`) describing their purpose, module kind, milestone, dependencies and
the closest live modules — no broken links anywhere. Flipping a slug live in
`MODULE_FLAGS` makes it appear everywhere at once. The full structure, the
route-preservation record and the documented overlaps live in
`docs/navigation-migration.md`.

| Section | What lives here (live modules in **bold**) |
|---|---|
| **HOME** | **Executive Intelligence Hub** (position & attention) **· Corporate Reporting Centre** (governed reporting decks, §5.15); My Finance Home, Notifications, Global Search (⌘K). |
| **DASHBOARDS** | **Management Accounts** (four-scope board pack + Actual-vs-Forecast dashboard) **· Three-statement model** (P&L · Balance Sheet · Cash Flow) **· Budget & Forecast · Store Sales & KPI · Franchise · Inventory · SKU Analysis · Cash Flow · Fixed Assets · Month-End Close** (status board); plus planned reference dashboards (Master, Company Store Performance, Wholesale, Treasury, PO & Procurement, Department/Project Budget, WAC, Digital Finance Team, Data Quality, Controls). |
| **PLAN** | **Forecast Builder · Scenario Planning · HO Business Projects · Departmental Budgets**; planned Budget Builder, Store/Wholesale/Franchise planning, Project budgets, Consolidated P&L. |
| **PERFORM** | **Management Accounts · Three-statement model · Store Performance (league) · Franchise · Inventory · Cash Flow · Fixed Assets** — the against-plan read; planned Wholesale/Treasury/Procurement performance. |
| **OPERATE** | **My Finance Week · Finance Team Schedule · the numbered close (1 · Month-End Close → 2 · Management Accounts Close → 3 · Close Cockpit, see §5.6) · Procurement · Action Centre · Intercompany · Task Review Queue · Task Library · Purchase Order Tracker**; planned WAC, Finance Projects. |
| **DIGITAL FINANCE TEAM** | **Agent Activity · Agent Reviews · AI Benefits** — three agents live: Store Priorities, Data Quality and **Trading Commentary** (the first LLM agent); the seven planned "master" agents (Chief Finance Intelligence, FP&A, Finance Operations, Commercial, Governance, Data, Executive Reporting) and Agent Exceptions. |
| **FINANCE DATA** | **Data Uploads** (one home for every governed input — see §6.9) **· Financial Statements Upload & Refresh** (board-pack layout + the Joiin statutory refresh) **· Entities** (the legal-entity register) **· Master Data Management** (lineage + KPI master); planned masters — Chart of Accounts, Stores, Departments, Projects, Cost Centres, Suppliers, Customers, Franchisees, Budget/Forecast Versions, Exchange Rates, KPI Definitions, Allocation Rules. |
| **GOVERN** | **Users, Roles & Permissions** (users, roles, department sign-off and per-department page access) **· SOP Library** (this Handbook) **· Report Builder**; planned Approvals (one inbox over the review queues), Controls, Data Quality, Audit Trail, System Settings. *(Govern is controls-only — the finance-data feeds moved to FINANCE DATA.)* |

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
6. **Build the trade deck** — run the **Trading Commentary** agent, review its
   narrative, and pair it with the Store Sales & KPI screens (see §5.14).

### Monthly
- **Refresh the consolidation** — FINANCE DATA → Financial Statements Upload & Refresh → **Refresh (this month)**
  (or **Full year**) pulls the month's per-entity P&L, the four board packs and the
  balance sheet from Joiin into the database. The monthly cron does this
  automatically on the 5th; run it by hand for an early or corrected close. **This
  refresh is the prerequisite for everything statutory below** (see §6.2). Nothing
  statutory updates from a page reload alone.
- **Management accounts close** — OPERATE → Management Accounts Close: run the
  pre-close checks (completeness/accrual, variable & fixed drift, sign) and work the
  reconciliation playbook before the numbers are relied on.
- **Management accounts** — DASHBOARDS / PERFORM → Management Accounts, once the
  month's Joiin board packs are refreshed (see §6).
- **Build the board deck** — export the four-scope board pack and review the
  three-statement model (see §5.13).
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

### 5.0 My Finance Home (HOME)

**HOME → My Finance Home** (`/finance-os/my-home`) is your personal landing page —
"here's your day" in one screen. A greeting and a **today's position** band of live
counts (Critical items, Open actions, Approvals awaiting you, AI recommendations,
Reports in progress, unread Notifications), then: **Needs you** (the ranked
cross-platform attention feed), **Your approvals** (task and agent reviews waiting on
your sign-off), **Your week** (your open tasks), the **Latest brief** (the governed
proactive briefing) and **Recent reports**. Every figure is a slice of an existing
governed feed — nothing is keyed here — so it always agrees with the module it links
to, and it degrades quietly when a feed is empty.

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

### 5.6 The month-end close — one process, three steps (OPERATE)

The close is **one process across three screens**, numbered so the order is
unambiguous. They are named **1 · … / 2 · … / 3 · …** in the sidebar so everyone
follows the same sequence: **1 = do the per-entity work, 2 = reconcile and decide
accruals, 3 = confirm readiness and lock.**

**1 · Month-End Close** (`/operate/month-end`) — the **execution board**. Every
entity's close tasks with an assignable **finance owner** and Open/Done chips, under
a **summary strip** (overall status + per-stage rollups). This is the single place the
per-entity month-end work is tracked and ticked off; the standalone legacy tracker is
retired.

**2 · Management Accounts Close** (`/operate/management-close`) — the **hands-on
reconciliation engine**. It takes the period's actuals, runs them against a reference
model, and produces **exceptions across four checks — completeness, variable drift,
fixed drift, sign** — each with a **confirm · correct · explain** review, plus a
per-period assurance playbook (the 18-step reconciliation). **This is where the
variance work actually happens and where accruals are decided.**

**3 · Close Cockpit** (`/operate/close`) — the **control tower / readiness view**.
Each period is a tracked "run" whose machine-checkable gates (actuals loaded, feeds
fresh, **pre-close exceptions cleared**, playbook done, tasks done, commentary
drafted) go green on their own; only genuine human sign-offs wait on a person. It is
the one-glance **"is this period ready to lock?"** screen **and the lock / reopen
control**.

**How they fit together.** *2 · MA Close finds and clears the variances; 3 · Close
Cockpit consumes "exceptions cleared" as one gate and owns the lock.* Step **1 ·
Month-End Close** tracks the per-entity task ticks that also feed the cockpit's "tasks
done" gate. The overlap is deliberate and the division is clean: **cockpit = status +
lock, MA Close = the detailed reconciliation.**

**Planned evolution.** As store-level P&Ls (the Miniso UK operating company and the
Franchise entity) move to an uploaded final-accounts pack, step **2 · Management
Accounts Close** will run its checks on that upload and gain a governed **AI accrual
recommendation** — variances split fixed vs variable, with suggested accruals put
forward as a draft for human sign-off (never auto-posted). The Joiin-based
three-statement model moves to OPERATE as the reconciliation tool (management accounts
vs statutory). Parked until the upstream input tools are finalised.

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

### 5.13 Building the board deck (the monthly board pack)

> *The "board deck" is the monthly, board-facing financial pack. In the app it is
> the four-scope board pack plus the three-statement model — the statutory,
> Joiin-sourced view. If you mean a different artefact by "board deck", tell Finance
> and this section will be adjusted.*

> **Now also available through the Corporate Reporting Centre (§5.15)** — the
> **Finance Board Deck** template produces this pack end-to-end (sections, governed
> figures, reviewed AI commentary, validation, approval, PowerPoint/Word/PDF/Excel). The
> steps below remain the module-by-module route and the source of the figures.

The board deck is **assembled from live modules, not rebuilt by hand** — the app
holds Joiin's own board-pack layout and renders it verbatim. The build:

1. **Prerequisite refresh (statutory).** FINANCE DATA → Financial Statements Upload & Refresh → **Refresh (this
   month)** so the month is loaded into `finance.joiin_boardpack` (all four scopes),
   `finance.joiin_pl_entity` and `finance.joiin_bs`. Without this the pack is empty
   and the feed banner stays on the Xero fallback (§6.2, §11).
2. **Prerequisite comparatives (optional but usual).** Load the **forecast** (PLAN →
   Forecast Builder, §5.7) and any **management actuals** (§6.7) so the
   Actual-vs-Forecast dashboard and drift checks have something to compare against.
3. **Layout governance (set once, reused).** The board-pack structure — sections,
   subtotals, derived lines (Gross Profit, EBITDA, margins) — is the governed **P&L
   format** per scope (FINANCE DATA → Financial Statements Upload & Refresh). Joiin computes the layout and the
   intercompany wholesale elimination; the app renders it.
4. **Review on screen.** DASHBOARDS / PERFORM → **Management Accounts** — the four
   tabs **Store · Head Office · Franchise · Consolidated**, plus the Actual-vs-Forecast
   dashboard and its analysis tabs. Then **Three-statement model** — the consolidated
   P&L (from the board pack), the Balance Sheet (`finance.joiin_bs`) and the derived,
   reconciled indirect Cash Flow.
5. **Assure before relying on it.** OPERATE → Management Accounts Close — run the
   pre-close checks (completeness/accrual, cost drift, sign) and clear the
   reconciliation playbook.
6. **Export.** On the Management Accounts toolbar: **⤓ Excel** (one sheet per loaded
   scope, for the chosen year and period — Current / Trailing / YTD) or **⎙ PDF**
   (a print-clean view, one scope per page → browser **Print → Save as PDF**). Both
   render from the *same* path as the screen, so the deck always matches the app.
   Every export writes a `management_accounts.export` audit event and carries the
   note *"Internal management reporting — review before any external use."*

**Cadence:** monthly, after month-end close and MA close assurance. **This is
management reporting, not statutory accounts** — unrestricted for internal use; do
not circulate externally without the sign-off in §12.

### 5.14 Building the trade deck (the weekly trading pack)

> *The "trade deck" is the weekly trading / commercial pack — company-owned store
> performance and its narrative. Unlike the board deck it has no single one-click
> export yet; it is assembled from the trading modules and the reviewed AI
> commentary. Tell Finance if you mean a different artefact.*

> **Now also available through the Corporate Reporting Centre (§5.15)** — the
> **Weekly Trade Pack** template assembles trading, margin, inventory, franchise and
> priority-action sections with reviewed AI commentary and one-click
> PowerPoint/Word/PDF/Excel export. The steps below remain the module route and the source
> of the figures.

The build:

1. **Prerequisite refresh (trading).** Load the latest **store sales** export
   (§6.1); freshness tolerance is 9 days, and the Data Quality agent / HOME flag
   stale data. Optionally refresh the **SKU** extract (§6.5) if the deck includes
   range performance.
2. **Review the numbers.** DASHBOARDS → **Store Sales & KPI** — executive view,
   store league, store drilldown and break-even — on the governed definitions (valid
   trading days, real stores only, ATV / conversion / like-for-like). Add **SKU
   Analysis** (80/20 sellers, new-SKU performance, dormant SKUs) where relevant.
3. **Draft the commentary (AI, reviewed).** DIGITAL FINANCE TEAM → Agent Activity →
   run **Trading Commentary**. It reads the governed company-store YTD net-sales /
   footfall vs last year (read-only) and drafts 2–4 short paragraphs using *only*
   those figures. It lands in **PENDING_REVIEW** — a human **approves / amends /
   rejects** it in Agent Reviews before it becomes an insight. Nothing the model
   writes is published unreviewed, and it cannot invent numbers (§5.11, §7).
4. **Assemble & share.** Pair the approved commentary with the Store Sales & KPI
   (and SKU) screens; use the browser **Print → Save as PDF** (every screen prints
   clean via the shared print stylesheet) for a shareable pack. The HOME trading
   tiles give the one-line headline.

**Cadence:** weekly. Trading figures are *store* figures (the green *Store · all*
source chip), kept deliberately separate from the statutory Joiin feed — see the two
truths in §5.1.

### 5.15 Corporate Reporting Centre (HOME)

The Reporting Centre (`HOME → Corporate Reporting Centre`, `/finance-os/home/reports`)
is **one governed engine** that produces corporate reporting decks from live Finance
OS data — replacing the old routine of screenshotting dashboards into PowerPoint.
Five templates ship: **Weekly Trade Pack · Management Accounting Report · Finance
Board Deck · Budget & Forecasts Deck · Franchise Deck**. It is one engine with five
templates, not five separate generators — new templates can be added without a
rebuild.

**The process (each report):**
**Select template → set period & scope → choose sections → pick data sources → choose
AI commentary → generate → review → validate → approve → export → archive.**

- **Governed figures.** Sections pull through **source adapters** — the same governed
  services behind the dashboards — so a report **reconciles to its source**. Where a
  feed isn't connected the section says *"Awaiting …"* rather than inventing a number
  (e.g. Treasury today).
- **AI commentary** reuses the Finance Intelligence Layer: ten perspectives
  (Executive, Finance Director, FP&A, Commercial Finance, Financial Controller, Cash &
  Treasury, Operational, Risk, Opportunity, Action). Every draft is labelled **AI
  DRAFT** with its perspective, confidence, data-through date and sources, and **must
  be reviewed**; unreviewed commentary can never enter an issued report.
- **Audience registers.** Instead of picking a perspective by hand you can draft for a
  named **audience** — *Executive · Management · Operational · Technical* (internal),
  or *CEO · Board · Investor / Group · Bank / Lender*. Each resolves to the right
  perspective, tone and emphasis. The four external/board-level registers are
  **listing-rules sensitive**: their drafts are **stamped with a governance banner**
  (e.g. *"⚠ DRAFT — Investor / Group … may contain inside / price-sensitive
  information; requires human sign-off and disclosure review before any external
  use"*) that travels into every export, and — like all commentary — they remain a
  **draft that a human must approve** before the report can be issued. The AI never
  releases anything.
- **Validation** runs a **PASSED / WARNING / FAILED** checklist (required sections,
  data availability & freshness, commentary reviewed, confidentiality set, reviewer &
  approver assigned). **A FAILED report cannot be approved or issued.**
- **Roles / segregation of duties.** Finance **creates, edits and reviews**;
  **approval and issue are an admin (Finance Director) right**. Executives view
  approved reports.
- **Versions.** Approving **freezes and locks a version snapshot** — an approved
  report never changes when the underlying data later moves.
- **Export.** Native **PowerPoint** (styled to the Finance OS identity), native
  **Word** (a real `.docx` — headings, KPI & data tables and governed commentary,
  for finance memos and board write-ups), **PDF** (print view → Save as PDF) and an
  **Excel appendix**; every export is recorded with a checksum.
  Confidentiality/DRAFT watermarks apply until approved.
- **Add to Report.** On a dashboard, **+ Add to Report** drops a chart/KPI/table into
  a draft (new or existing), keeping its **source and current filters** so it
  refreshes from governed data — never a screenshot.

**Cadence:** per template — Weekly Trade Pack weekly; Management Accounting Report and
Franchise Deck monthly after MA close (§5.6); Finance Board Deck monthly/quarterly;
Budget & Forecasts Deck each planning cycle. The board deck (§5.13) and trade deck
(§5.14) are now produced here via their templates.

### 5.16 Purchase Order Tracker (OPERATE)

**OPERATE → Purchase Order Tracker** (`/operate/po-tracker`) lets a department raise
a P.O after generating the number in Xero. The build:

1. **Generate the number in Xero first**, then record the P.O here — date, supplier,
   payment terms & date, currency, **net value** (£), category, **Xero P.O number**,
   **fulfilment start date**, **fulfilment period in days**, and the **department**
   (a dropdown of the governed departments — the same list assignable per user in
   GOVERN → Users & Roles).
2. **Marketing spend** asks one extra question — *is it part of the marketing levy?*
   **Yes** → allocate to stores with **no invoice**; **No** → **finance issues an
   invoice**. The chosen outcome is recorded on the P.O.
3. **Recharge** (optional): either tick **Head Office only** (allocates 100% to Head
   Office — no store split), or recharge to **stores** — tick **all stores** or pick
   individually, then set each store's **% of the net value**. An **Equal split**
   button spreads it evenly; the running total is shown live and **must equal 100%** —
   a P.O cannot go to sign-off until it does.
4. **Save draft** at any point; **Create & submit for sign-off** once complete. A
   submitted P.O rests at **awaiting department-head sign-off** — the sign-off itself
   is enforced by the forthcoming **user controls**.

The P.O and its recharge allocation are governed data (`finance.purchase_order` +
`finance.purchase_order_recharge`, migrations 046/047), audited on every change. The
seven operating departments (Finance, Marketing, Merchandising, Operations, HR,
Logistics, Architecture & Build) are governed in `core.dim_department` and assignable
per user in **GOVERN → Users, Roles & Permissions**.

### 5.17 Departmental Budgets (PLAN — HO)

**PLAN — HO → Departmental Budgets** (`/plan/dept-budget`) is where a department head
builds their department's budget for the year. The build:

1. **Create a budget** — pick the **department**, the **budget year** and a **version
   label** (versions are kept, never overwritten). It opens seeded with a **starter set
   of cost lines** for that department (editable), so nobody starts from a blank sheet.
2. **Build the grid** — cost lines are grouped into **categories** down the side and
   the **12 months (Jan–Dec)** run across the top. Enter each line's monthly phasing;
   the **full-year total**, the **category subtotals**, the **monthly column totals** and
   the **grand total** all calculate live, alongside a **prior-year** comparison and the
   **variance**. Add or remove lines and categories; the **≡** button spreads a full-year
   figure evenly across the 12 months.
3. **Save** while it is a **Draft**. **Submit for sign-off** when it is ready — it moves
   to **Submitted** and locks. The department's **sign-off approvers** (set in GOVERN →
   Users, Roles & Permissions → Department sign-off), or an admin, then **Approve** it.
   **Reopen** returns an approved/submitted budget to Draft for further edits.

Who can do what: **Admins and Finance** can build any department's budget; a department
member can build **their own** department's. **Approval** is limited to that department's
listed sign-off approvers (or an admin). Budgets are governed data
(`finance.dept_budget` + `finance.dept_budget_line`, seeded from
`finance.dept_budget_template`, migration 049) and audited on every change.

---

## 6. Data feeds, refresh & how it all maps

**The rule that makes the whole system predictable:** when a screen renders it reads
**only the database** — it never calls an outside system to draw a page. Outside
systems are called **only during a refresh**. So *every* output is driven by a stored
feed, and a feed only changes when someone (or the cron) runs its refresh. If a
number looks wrong, the question is always *"which input, and was its refresh run?"*

### 6.0 The map — input → refresh → output

Read this left to right: an **input** is loaded by a **refresh action** into one or
more **tables**, and those tables **drive** specific outputs. Nothing downstream moves
until the refresh runs.

| Input (source) | Refresh / load action & where | Stored in | Drives (output) | Cadence |
|---|---|---|---|---|
| **Store sales** (trading export) | Regenerate the load SQL and run it in the DB (§6.1) | `core`/`finance` store-sales facts | Store Sales & KPI, HOME trading tiles, Trading Commentary agent → **trade deck** | Weekly (≤ 9-day freshness) |
| **Joiin consolidation** (statutory, 26 companies) | **App-side API refresh** — FINANCE DATA → Financial Statements Upload & Refresh → *Refresh (this month)* / *Full year*; monthly cron (§6.2) | `finance.joiin_pl_entity`, `finance.joiin_boardpack` (4 scopes), `finance.joiin_bs` | Feed source flips to Joiin; Management Accounts (4-tab board pack + Actual-vs-Forecast), Three-statement model, scope banner, Executive Hub finance tiles → **board deck** | Monthly (cron 5th) + on demand |
| **Joiin by-company P&L** (workbook) | Manual alternative to the API — FINANCE DATA → Financial Statements Upload & Refresh → *Upload workbook* (one sheet per month, entities in columns) (§6.2) | `finance.joiin_pl_entity` | Per-entity board-pack P&L, entity drill-down | As needed (API is the default) |
| **P&L format template** (board-pack layout) | FINANCE DATA → Financial Statements Upload & Refresh → *Upload format* (§6.8) | `finance.pl_format` (migration 022) | The **layout** of every board pack — sections, subtotals, derived lines, nominal mapping | On change |
| **Forecast** (3-tab store workbook) | PLAN → Forecast Builder → *Upload workbook* (§6.4) | `finance.forecast_input` (013/018) | Budget & Forecast, Scenario Planning, MA Actual-vs-Forecast comparatives, MA-close drift checks | Quarterly / planning |
| **Management actuals** (store × nominal workbook) | DASHBOARDS/PERFORM → Management Accounts → *Excel upload* (§6.7) | `finance.mgmt_actual` (019) | MA Actual/Forecast/Budget blend | Monthly (where used) |
| **Procurement** (CSV) | OPERATE → Procurement → upload (§6.5) | procurement tables (016) | Procurement cash-budget-vs-terms | Monthly |
| **SKU** (CSV) | DASHBOARDS → SKU Analysis → upload (§6.5) | sku tables (017/025) | SKU Analysis (80/20 · new · dormant) | As available |
| **Intercompany** (CSV / manual) | OPERATE → Intercompany (§5.10) | intercompany ledgers (008) | Intercompany tracker | Monthly |
| **Entities & Joiin id map** | FINANCE DATA → Entities; `finance.joiin_entity_map` (031) | entity register + id map | *Which* companies the Joiin refresh pulls and the consolidation scope banner | On change |

Two independent "truths" run through this map and are never mixed: **store trading**
(the store feed → trade deck) and **statutory finance** (Joiin → board deck). Each
carries its own source chip and as-at date.

### 6.1 Store sales (trading)
Loaded from the store data export. To refresh: regenerate the load SQL from the
latest export and run it in the database (each load replaces the slice it covers and
writes a `data_refresh_log` entry). Freshness tolerance is **9 days** — the Data
Quality agent flags older data, and HOME shows it stale.

### 6.2 Consolidation feed — Joiin (statutory)
**Joiin is the connector** for consolidated statutory finance (26 companies, with
eliminations), replacing the direct Xero connection. The app now calls **Joiin's API
directly during a refresh** (it still never calls out at page-render time). The
active source is resolved by `getActiveSource()`, which **returns `JOIIN` as soon as
the Joiin tables carry rows** (`finance.joiin_boardpack` or `finance.joiin_pl_entity`)
and otherwise falls back to `XERO`. So the whole deck flips to the Joiin
consolidation the moment a refresh has loaded data — and *only* then.

**How to refresh (the normal path — app-side API):**
1. Go to **FINANCE DATA → Financial Statements Upload & Refresh** and click **Refresh (this month)** (current month,
   fast) or **Full year** (year-to-date).
2. The browser drives the refresh in **small chunks** — per month: the per-entity
   P&L, then one board pack per scope (Store / Head Office / Franchise /
   Consolidated), then the balance sheet — so no single call runs long enough to time
   out. A chunk that warns (e.g. an un-migrated table, or an empty report) is
   reported but **does not fail the whole run**.
3. Each chunk writes its rows and an audit event: per-entity P&L →
   `finance.joiin_pl_entity`; board packs → `finance.joiin_boardpack`; balance sheet
   → `finance.joiin_bs`. The finish line reports the counts, e.g. *"Refreshed from
   Joiin: 209 per-entity rows, 4 board pack(s) and 148 balance-sheet rows across
   2026-07."*
4. The **monthly cron** (`/api/joiin-refresh`, 06:00 on the 5th) runs the same
   year-to-date pass automatically in one invocation.

**Requirements & gates:**
- **`JOIIN_API_KEY`** must be set as a Vercel environment secret (§9). Without it the
  refresh returns *"JOIIN_API_KEY is not set"* and writes nothing.
- The **Joiin tables must be migrated** onto the database first (migrations 014, 020,
  021, 023, 036 — §9). A screen whose table is absent shows a setup prompt, and a
  refresh chunk warns rather than crashing.
- Board-pack **layout** is governed by the P&L format per scope (§6.8); Joiin computes
  the consolidation and the intercompany wholesale elimination, and the app renders
  its board pack verbatim.
- Real figures are loaded into the database only and are **never committed to the
  repo**.

**Manual fallback (no API):** if the API is unavailable, the same per-entity P&L can
be loaded from a **Joiin by-company workbook** — FINANCE DATA → Financial Statements Upload & Refresh → *Upload
workbook* (one sheet per month, entities across the columns). It upserts the months
in the file into `finance.joiin_pl_entity`.

> **Why a page reload never fixes an empty deck.** The screens read the database
> live, but the database only changes on a refresh. If the feed banner still reads
> Xero/Cambridge, the Joiin tables are empty for that period — run the refresh above
> (see also §11).

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

### 6.6 Intercompany
Loaded through **OPERATE → Intercompany** by CSV upload or manual entry across the
three ledgers (cash, inventory & recharges, disbursements). UK dates (DD/MM/YYYY)
normalise to ISO on load. Drives the intercompany tracker only (§5.10).

### 6.7 Management actuals (the blend)
Where the month is reported by **store × nominal**, load the actuals workbook via
**DASHBOARDS / PERFORM → Management Accounts → Excel upload** → `finance.mgmt_actual`.
The management-accounts engine then blends **Actual / Forecast / Budget** into one
view. This is distinct from the Joiin board pack (which is the consolidated,
Joiin-laid-out P&L); the two are complementary.

### 6.8 P&L format templates (board-pack layout)
The **shape** of every board pack — sections, subtotals, derived lines (Gross Profit,
EBITDA, margins) and how each nominal maps to a line — is governed data, not code.
Upload a template per scope via **FINANCE DATA → Financial Statements Upload & Refresh → Upload format** →
`finance.pl_format`. Friendly-named lines that don't map by name are flagged to map
by hand. Changing a format re-lays the board pack without a deploy; it does not
change the underlying figures.

### 6.9 The Data Uploads hub (one intake)
**FINANCE DATA → Data Uploads** (`/data/uploads`) is the single home for every
governed input that drives the platform — so there is one place to look for "where
do I load X?". Live feeds upload **in place, right on this page** (no redirect); a secondary link
opens the fuller screen for advanced controls (year view, Joiin refresh, nominal
mapping).

- **Connected (live) feeds** — link straight to their uploader:
  **Financial Statements Upload & Refresh** (§6.2/§6.8), **Management Accounts —
  Actuals** (§6.7; current-year and prior-year workbooks uploaded separately, by
  month), and **Budget & Forecast** (§6.4). Other in-app inputs (Forecast, SKU,
  Intercompany, Procurement) are linked too.
- **Planned feeds** — shown honestly as *awaiting format* until the layout is pinned:
  **Sales data** (self-serve store-sales uploader), **Inventory**, **Treasury**
  (bank-facility / forward-cash feed) and **Fixed & Variable cost tagging**. The
  cost split will benchmark the **Management Accounts Close** analysis — variances
  split fixed vs variable, feeding the AI accrual recommendations (§5.6).

Every load updates the same governed tables the dashboards, management accounts, the
month-end close and the Corporate Reporting Centre read from, so one upload flows
through the whole platform. Govern is left as controls-only; the data feeds live
here.

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
- **Environment variables:**
  - `DATABASE_URL` — the Neon connection string (the app also accepts Vercel's
    prefixed names).
  - `SESSION_SECRET` — a long random string for session signing.
  - `JOIIN_API_KEY` — **required for the Joiin refresh** (§6.2); optional
    `JOIIN_API_BASE` overrides the API host.
  - `ANTHROPIC_API_KEY` — required for the **Trading Commentary** LLM agent (§5.11);
    optional `ANTHROPIC_MODEL` overrides the model.
  - `CRON_SECRET` — the bearer token Vercel Cron presents to the refresh and close
    cron endpoints; requests without it are rejected.
  - `MFA_SECRET_KEY` — key for the opt-in TOTP MFA; `ENFORCE_ROLE_GATES` toggles
    route-guard enforcement.
- **Scheduled jobs (Vercel Cron, in `vercel.json`):** Joiin refresh
  `/api/joiin-refresh` at **06:00 on the 5th** each month (full year-to-date pass);
  close cron `/api/close/cron` at **07:00 on weekdays**.
- **Deploys:** pushing to `main` triggers a Vercel deploy; pull requests get a
  preview deploy. **Migrations do not run on deploy** — they are applied to the
  database separately (below), so a new table appears in production only once its
  migration has been run there.
- **Migrations:** SQL files in `db/migrations/`, each idempotent with a rollback
  header (`BEGIN`/`COMMIT`, `CREATE … IF NOT EXISTS`, seed-only-if-empty guards).
  Apply them with `DATABASE_URL=… npm run migrate` (tracks what has run in
  `public.schema_migration`), or paste the SQL into the Neon SQL editor. Run them
  **in ascending order**; all are safe to re-run. A screen whose table isn't present
  yet renders a "run migration NNN" setup card rather than crashing — so a missed
  migration is a prompt, not an outage.
- **Current migrations (001–037, with 024 and 032 intentionally unused):** 001 roles
  & audit · 002 navigation & definitions · 003 workflow · 004 agents · 005 action
  centre · 006 Xero finance feed · 007 entities · 008 intercompany · 009 budget &
  forecast · 010 dashboards section · 011 restore plan section · 012
  management-accounts close · 013 forecast inputs & scenarios · **014 Joiin feed
  metadata** · 015 month-end task owner · 016 procurement · 017 SKU analysis · 018
  forecast store→entity · 019 management actuals · **020 Joiin consolidated P&L
  detail** · **021 Joiin per-entity P&L** · 022 P&L formats · **023 Joiin board pack**
  · 025 SKU analysis detail · 026 business projects · 027 sessions · 028 forecast
  versions · 029 MFA · 030 login throttle · **031 Joiin entity map** · 033 trading
  commentary agent · 034 notifications · 035 close orchestration · **036 Joiin
  balance sheet** · 037 report definitions. *(The Joiin feed tables — 014, 020, 021,
  023, 036 — are the ones the board deck and three-statement model depend on.)*

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
| **Feed banner still says "Real Xero feed … Cambridge"; board pack / three-statement empty** | The Joiin tables have no rows for that period — the refresh hasn't run (a page reload can't fix this) | FINANCE DATA → Financial Statements Upload & Refresh → **Refresh (this month)** / **Full year** (§6.2), then reload. |
| **Refresh reports "JOIIN_API_KEY is not set"** | The Joiin API secret is missing in this environment | Add `JOIIN_API_KEY` in Vercel → Environment Variables, redeploy, retry (§9). |
| **Refresh warns "… empty board pack" for a scope** | Joiin's custom report returned no rows for that scope/month | Check the month is closed in Joiin; other scopes still load. |
| **Trading Commentary agent fails** | `ANTHROPIC_API_KEY` not set | Add it in Vercel (Sensitive, all environments); the rest of the app is unaffected (§5.11, §9). |
| A dashboard shows an *illustrative* badge | No real extract loaded yet (Franchise, Inventory, Fixed Assets, Procurement, SKU) | Upload the real data; the badge clears. |
| HOME shows data as stale | Store load older than 9 days | Refresh the store feed. |
| Finance figures look too small / one entity | Joiin refresh hasn't run (falls back to a single Xero org) | Run the Joiin refresh (§6.2); the scope banner then reads "26 companies". |
| A consolidation load is refused | Totals don't reconcile to the source | Investigate the source; the mapper is protecting you from a bad load. |
| Forecast upload "not loaded" | No readable rows found in the workbook | Check the three tab names & headers; partial uploads are fine but need at least one valid row. |
| "Not signed in" / redirect to login | Session expired (12h) or `SESSION_SECRET` unset | Sign in again; check the env var. |
| Migration errors | Run out of order | Run 001→037 in order; all are safe to re-run. |
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
- **Joiin** — the consolidation connector (26 companies, eliminations). The app calls
  its API during a refresh; `getActiveSource()` returns `JOIIN` once the Joiin tables
  carry rows, otherwise falls back to `XERO`.
- **Board pack** — Joiin's consolidated P&L, laid out per scope (Store / Head Office
  / Franchise / Consolidated) in `finance.joiin_boardpack`; rendered verbatim in
  Management Accounts.
- **Board deck** — the monthly board-facing pack: the four-scope board pack + the
  three-statement model, exportable to Excel/PDF (§5.13).
- **Trade deck** — the weekly trading/commercial pack: Store Sales & KPI + SKU
  Analysis + the reviewed Trading Commentary narrative (§5.14).
- **Three-statement model** — the linked consolidated P&L (board pack), Balance Sheet
  (`finance.joiin_bs`) and derived, reconciled indirect Cash Flow.
- **P&L format** — the governed board-pack layout per scope (`finance.pl_format`):
  sections, subtotals, derived lines and nominal mapping (§6.8).
- **source_system** — the tag distinguishing real feeds (`JOIIN`, `XERO`, the store
  load) from demo data (`DEMO`); real dashboards read only real sources.
- **Freshness / `data_refresh_log`** — the record of when each feed last loaded;
  drives the staleness warnings.

---

*Keep this SOP in step with the platform. When a phase or feed changes, update the
relevant section and bump the version and date above.*
