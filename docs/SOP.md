# Miniso UK Finance Operating System — Standard Operating Procedure

**Version 1.2 · 20/07/2026 · Owner: Finance (Miniso UK)**

> Also available in-app: **Govern → Handbook** (`/handbook`) renders this for the
> signed-in team.

This is the operating manual for the Finance Operating System (FOS): what it is, who
does what, the weekly and monthly rhythm, how each module works, how the data feeds
are kept fresh, and how the governance controls hold. It reflects the platform as
delivered through Phase 8 (the specialist dashboards gathered under a single
DASHBOARDS section).

> **Entity note.** In this document and everywhere in the app, the business is
> "Miniso UK". The underlying legal entities (e.g. *Kouriten Cambridge Limited*,
> *Kouriten Limited t/a Miniso UK*) are named precisely only where a document is
> legal, statutory, or a connected-system identifier (bank, HMRC, Companies House,
> Xero org names).

---

## Contents
1. Purpose & what the FOS is
2. Access, roles & permissions
3. The pillars
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
trading, statutory finance), the work (a governed weekly schedule), the assistance
(reviewable AI agents), and the follow-through (an action & benefits register) into
one place, under one audit trail and one role model.

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
| **FINANCE** | Run agents; approve task reviews; approve action closure; validate benefits; generate the weekly schedule; manage entities. |
| **EXEC** | Approve action closure; validate benefits. |
| **OPS** | Do and complete assigned work; raise actions. Cannot approve closure or validate benefits. |

**Key permission rules:**
- **Run an AI agent:** ADMIN or FINANCE.
- **Approve a task at review:** the task's reviewer, or a manager (ADMIN/FINANCE).
- **Approve action closure / validate a benefit:** ADMIN, FINANCE or EXEC — and,
  as good practice, not the sole person who did the work.
- **Manage users:** ADMIN only.

Everyone signed in can view all dashboards; the controls above gate *actions*, not
*visibility*.

---

## 3. The pillars

The top navigation is the same on every screen.

| Pillar | Route | Purpose |
|---|---|---|
| **HOME** | `/finance-os/executive` | Executive Intelligence Hub — position, what needs attention, operating health. |
| **PLAN** | `/plan` | Strategic planning — Budget & Forecast (its home), with scenario planning to follow. |
| **DASHBOARDS** | `/dashboards` | The seven specialist dashboards: Management Accounts, Budget & Forecast, Cash Flow, Store Sales & KPI, Inventory, Franchise, Fixed Assets. Each declares its data provenance (real feed vs illustrative). |
| **OPERATE** | `/operate` | Operational controls: the Month-end close and Intercompany. |
| **WORKFLOW** | `/perform` | The finance team's cadence — My Week, Team Schedule, Review queue and the Task Library. |
| **AI CONTROL TOWER** | `/ai` | The Finance Agent Control Centre. |
| **GOVERN** | `/govern` | Users & roles, Entities, Action Centre, Benefits tracker, and this Handbook. |

**Start every day at HOME.** It is exception-led: it surfaces what needs a person's
decision and links straight to where that decision is made.

---

## 4. The operating rhythm

### Daily
- **Check HOME → "Needs attention".** It is ranked by severity and merges: KPI
  breaches, AI outputs awaiting sign-off, agent exceptions, overdue critical tasks,
  and high-value / overdue / awaiting-closure actions. Each row links to where you
  act. Clear the critical items first.
- **Clear the AI review queue** (AI Control Tower → Review) so nothing material sits
  unreviewed.

### Weekly (Monday)
1. **Generate the week** — WORKFLOW → Schedule → *Generate week*. This creates dated
   task instances from the active templates (idempotent — safe to click twice).
2. **Team picks up work** — each person works their tasks in WORKFLOW → My Week
   (assign → in progress → ready for review / complete).
3. **Reviewers approve** — WORKFLOW → Review clears tasks that require a second pair
   of eyes. Approval, not completion, moves a task to COMPLETE.
4. **Run the store agents** — AI Control Tower → run *Store Priorities* and *Data
   Quality*; review their outputs.
5. **Review store trading** — DASHBOARDS → Store Sales (executive view, league,
   drilldown, break-even) once the weekly store data is loaded.

### Monthly
- **Management accounts** — DASHBOARDS → Management Accounts, once the month's Xero
  actuals are loaded (see §6).
- **Month-end close** — work the monthly close tasks on the schedule.
- **Benefits validation** — GOVERN → Benefits: validate realised value on delivered
  actions (ADMIN/FINANCE/EXEC).
- **Action review** — GOVERN → Action Centre: chase overdue, approve closures.

### Quarterly
- Review agent performance and controls (AI Control Tower), refresh task templates
  (WORKFLOW → Library), and review roles (GOVERN → Users).

---

## 5. Module procedures

### 5.1 Executive Intelligence Hub (HOME)
Two truths, kept visibly separate by source chips so they're never confused:
- **Trading — all stores** (green *Store · all* chip): revenue & gross margin from
  the store feed.
- **Statutory finance — connected entities** (blue *Xero* chip): revenue, gross
  profit, net result, cash from the real Xero feed, consolidated across the entities
  currently connected (the header states how many and as at when).

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

### 5.3 Weekly Finance Schedule (WORKFLOW)
A controlled task workflow. **11 statuses**; the important rule is that an assignee
can only take a task to *Ready for review* (or *Complete* where no review is
required) — **only a reviewer's decision** moves it to Complete or Returned.
- **My Week** — your tasks; claim available ones, progress your own.
- **Schedule** — the whole team's week and capacity; generate the week here.
- **Review** — the queue of tasks waiting for a reviewer.
- **Library** — the task templates (weekly & monthly) that generate the work.
Overdue tasks escalate automatically and surface on HOME.

### 5.4 Finance Agent Control Centre (AI CONTROL TOWER)
AI agents assist; they never act. Two agents ship today: **Store Priorities**
(flags stores needing attention vs last year) and **Data Quality** (freshness,
footfall coverage, invalid days, overdue critical tasks).
- **Guardrails are structural, not prompt-based:** agents can only *read* (SELECT).
  There is no code path for posting journals, moving money, changing forecasts or
  sending communications.
- **Run → review lifecycle:** a run produces outputs; **material** outputs (by the
  agent's £ materiality threshold) require human review. In Review, a reviewer
  **approves / amends / rejects** each output. Approve or amend turns it into an
  insight; optionally "create action" sends it to the Action Centre tagged AI_AGENT
  and linked to the run. Nothing reaches an action without that sign-off.

### 5.5 Action Centre & Benefits (GOVERN)
One register for actions from every source (dashboard, month-end, weekly task, AI
agent, board, control, audit, manual).
- **Lifecycle:** OPEN → IN_PROGRESS → COMPLETE → CLOSED, plus CANCELLED and OVERDUE.
  **COMPLETE** = the owner says the work is done. **CLOSED** = closure *approved* by
  ADMIN/FINANCE/EXEC — a separate event. Add progress notes and evidence throughout.
- **Benefits:** an action with an expected value auto-creates a **benefit
  opportunity**. Record **realised** value (a measurement), then **validate** it
  (ADMIN/FINANCE/EXEC) → the opportunity becomes VALIDATED. The Benefits tracker
  splits expected / realised / validated by **AI vs human** origin.

### 5.6 Finance dashboards on the real feed (DASHBOARDS)
- **Management Accounts** — the real Xero P&L by account, consolidated across
  connected entities, with the scope banner. Budget/forecast comparatives are blank
  until a real plan is loaded (no illustrative numbers).
- **Budget & Forecast** — real actuals; budget & forecast await the planning cycle.
- **Cash Flow & Treasury** — real reconciled cash; bank facilities and forward
  cashflow await the treasury feed.

Every finance screen carries the **Real Xero feed** banner stating which entities
are live and as at when.

---

## 6. Data feeds & refresh

The deployed app reads only its database. Feeds are loaded into that database; the
app never calls an external system at runtime.

### 6.1 Store sales (trading)
Loaded from the store data export. To refresh: regenerate the load SQL from the
latest export and run it in the database (each load replaces the slice it covers and
writes a `data_refresh_log` entry). Freshness tolerance is **9 days** — the Data
Quality agent flags older data, and HOME shows it stale.

### 6.2 Xero finance (statutory)
Because the app can't call Xero, a refresh is done in a Claude session (or a future
scheduled routine):
1. **Pull** the P&L and cash position from the connected Xero organisation.
2. **Map & reconcile** through the mapping rules — income positive, costs negative;
   the mapper **reconciles to Xero's own section totals and refuses the load if a
   penny is lost**. Unmapped accounts fall to Central Overheads and are reported.
3. **Ingest** the normalized extract (tagged `source_system = 'XERO'`), idempotent
   per entity/period; a refresh-log entry and audit event are written.
4. Real figures are loaded internally only and are **not committed to the repo**.

**Reconciliation is the gate.** A Xero load is only accepted when its account
totals match the Xero report exactly.

### 6.3 Adding a Xero entity (consolidation)
Miniso UK spans several legal entities (managed under **GOVERN → Entities** —
display name, legal name, type and Xero connection status). The dashboards
consolidate whatever is connected. To add one: create/confirm it under Entities,
connect its Xero org (a `finance.xero_org_map` row), then load it as above. The
dashboards consolidate it automatically and the scope banner updates.

> The standalone legacy month-end close tracker has been **retired** — month-end
> now runs through the WORKFLOW weekly schedule, so there is one place for the work.

---

## 7. Governance & controls

- **Separation of duties.** Task completion vs reviewer approval; action completion
  vs closure approval; benefit realised vs validated — always different events, and
  closure/validation require ADMIN/FINANCE/EXEC.
- **AI guardrails.** Structural read-only access; material outputs always reviewed;
  approve/amend/reject recorded; the insight→action link preserved end to end.
- **Audit trail.** Every state change (logins, task moves, agent runs & reviews,
  action transitions, closures, benefit validations, data loads) writes a
  `governance.audit_event`. This is the record of who did what, when.
- **Materiality.** Agent outputs above the agent's £ threshold require review;
  below-threshold, non-report outputs still route to review by default.
- **Freshness.** The Data Quality agent and HOME surface stale or incomplete feeds.

---

## 8. Roles & responsibilities

Responsibilities are assigned by **role** (above) and by the owner/reviewer fields
configured on each task template, dashboard and agent. As a guide:

| Activity | Accountable | Does the work |
|---|---|---|
| Weekly schedule generated & staffed | Finance lead (FINANCE) | Finance team |
| Task review & sign-off | Named reviewer / manager | — |
| Agent runs & output review | FINANCE | FINANCE |
| Action closure approval | ADMIN/FINANCE/EXEC | Action owner completes |
| Benefit validation | ADMIN/FINANCE/EXEC | Owner records realised |
| Store data & Xero refresh | Finance lead | Finance / scheduled routine |
| User & role administration | ADMIN | — |

Specific owners are configured in the app (task templates, dashboard registry, agent
registry) and can be changed there without code.

---

## 9. Environment, deployment & migrations

- **Hosting:** the app runs on Vercel; the database is Neon (PostgreSQL 16).
- **Environment variables:** `DATABASE_URL` (the connection string; the app also
  accepts Vercel's prefixed names) and `SESSION_SECRET` (a long random string).
- **Deploys:** pushing to `main` triggers a Vercel deploy; pull requests get a
  preview deploy.
- **Migrations:** SQL files in `db/migrations/` (001–006), each idempotent with a
  rollback header. Run them in order in Neon; all are safe to re-run. After a schema
  change, run the new migration in Neon before or with the deploy.
- **Current migrations:** 001 roles & audit · 002 navigation & definitions ·
  003 workflow · 004 agents · 005 action centre · 006 Xero finance feed.

---

## 10. Extending the system

- **New task template:** add it in the workflow templates; it starts generating with
  the next week.
- **New dashboard:** add a `dashboard_registry` row (pillar + route) and build the
  page; it appears under its pillar automatically.
- **New agent:** register it, add a read-only implementation behind the runner (it
  inherits the SELECT-only guardrail and the review lifecycle), and set its
  materiality threshold.
- **New action source:** already supported by the source taxonomy — just raise the
  action with that source.
- **New finance entity:** see §6.3.

Keep the pattern: extend existing tables, keep rules pure and unit-tested, write a
migration, verify on a replica, then ship.

---

## 11. Troubleshooting runbook

| Symptom | Likely cause | Fix |
|---|---|---|
| A dashboard says "Awaiting … feed" | That feed isn't loaded in this database | Run the relevant load (§6). |
| HOME shows data as stale | Store load older than 9 days | Refresh the store feed. |
| Finance figures look too small / one entity | Only one Xero org is connected | Expected — connect more entities (§6.3). The scope banner explains. |
| A Xero load is refused | Totals don't reconcile to Xero | Investigate the source; the mapper is protecting you from a bad load. |
| "Not signed in" / redirect to login | Session expired (12h) or `SESSION_SECRET` unset | Sign in again; check the env var. |
| Migration errors | Run out of order | Run 001→006 in order; all are safe to re-run. |
| A user can't approve closure | They lack ADMIN/FINANCE/EXEC | Grant the role in GOVERN → Users (ADMIN). |

---

## 12. Security & data handling

- **Naming:** "Miniso UK" in all outputs; legal entity names only in legal/statutory
  or connected-system contexts.
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
- **Material output** — an AI output above the agent's £ threshold; always reviewed.
- **Completion vs closure** — completion is the owner saying work is done; closure is
  a separate approval by ADMIN/FINANCE/EXEC.
- **Benefit opportunity → measurement → validation** — expected value → realised
  value recorded → value validated by finance.
- **Connected entity** — a Xero organisation whose actuals are loaded and
  consolidated into the finance dashboards.
- **source_system** — the tag distinguishing real feeds (`XERO`, the store load)
  from demo data (`DEMO`); real dashboards read only real sources.
- **Freshness / `data_refresh_log`** — the record of when each feed last loaded;
  drives the staleness warnings.

---

*Keep this SOP in step with the platform. When a phase or feed changes, update the
relevant section and bump the version and date above.*
