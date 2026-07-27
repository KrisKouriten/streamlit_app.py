# Corporate Reporting Centre — Product Specification

_Miniso UK Finance OS. What the Corporate Reporting Centre does, how a report
moves through it, and who can do what._

## Principle

One governed **Corporate Reporting Engine**, not five isolated generators. A
report is a template-derived **instance** → ordered **sections** (each a page) →
**components** (KPI / table / chart / commentary / action …). Every figure stays
traceable to a governed Finance OS source; AI commentary is drafted through the
governed Intelligence Layer and stays a draft until a person signs it off; an
approved report is a frozen version that never changes when the underlying data
moves.

## Navigation

- **HOME → Corporate Reporting Centre** at **`/finance-os/home/reports`**
  (registered in `lib/nav-registry.js`).
- **New report wizard** — `/finance-os/home/reports/new` (Step 1: report
  details).
- **Builder** — `/finance-os/home/reports/[id]` (the three-panel editor).
- **Print / PDF view** — `/finance-os/home/reports/[id]/print`.
- **API** — `/api/reports-centre` (list / create),
  `/api/reports-centre/[id]` (resolve + all mutating ops),
  `/api/reports-centre/[id]/export` (PPTX / XLSX),
  `/api/reports-centre/add-to-report`.

### The centre home

The landing page shows reporting **health** (total / in-progress / completed /
overdue), the **five template cards**, a **"Reports requiring attention"** feed
(missing data, unreviewed commentary, returned, approval-required, overdue), the
viewer's **drafts**, and **recent reports**. Before migration 045 it degrades to
an honest "not migrated yet" panel.

## The five templates

Seeded by migration 045 and visible as cards from day one:

| Template | Frequency | Default confidentiality | Sections |
|---|---|---|---|
| **Weekly Trade Pack** | Weekly | INTERNAL | 17 |
| **Management Accounting Report** | Monthly | CONFIDENTIAL | 15 |
| **Finance Board Deck** | Monthly / quarterly | BOARD | 14 |
| **Budget & Forecasts Deck** | Annual + each reforecast | CONFIDENTIAL | 14 |
| **Franchise Deck** | Monthly | CONFIDENTIAL | 15 |

Each template carries a default ordered section structure, a default source
adapter and default AI perspective per section, mandatory-section flags, a
default confidentiality classification and a set of default commentary
perspectives. In this release the **Weekly Trade Pack** is wired end-to-end
against live/governed data; the other four are fully seeded and usable, with
several sections drawing on adapters that are still awaiting a dedicated feed.

## The workflow: create → review → approve → export → archive

1. **Create.** From a template card, a finance/admin user opens the wizard, sets
   the title, reporting period, data-through date, comparison basis, display
   units, confidentiality, audience, owner, reviewer, approver and expected issue
   date. `createReport` copies the template's sections into the new **DRAFT** and
   opens the builder.
2. **Build.** In the builder the owner includes/excludes and reorders sections,
   reviews the governed data resolved onto each page, generates AI commentary per
   section, edits and signs off that commentary, and takes draft snapshots.
3. **Review.** `submit_for_review` → **REVIEW_READY**; a reviewer `start_review`
   → **IN_REVIEW**, then either `return` (→ **RETURNED** for amendment) or
   `ready_for_approval` (→ **APPROVAL_READY**).
4. **Approve.** `approve` → **APPROVED**. Approval is a governed gate: it is
   blocked if validation has failed, and on success it **freezes a locked version
   snapshot** so the approved report never changes silently.
5. **Issue.** `issue` → **ISSUED** (stamps the issue date). `supersede` and
   `archive` handle later revisions and retirement.
6. **Export** is available throughout: native PowerPoint, an Excel appendix, and
   print/PDF. Drafts are watermarked and may include clearly-marked draft
   commentary; approved/issued exports carry only approved commentary.

## The three-panel builder

`app/finance-os/home/reports/[id]/builder.js` presents:

- **Left — structure.** Every section with an include checkbox, a data-status
  dot (READY / PARTIAL / PENDING / MISSING) and move-up/down controls. Mandatory
  sections cannot be excluded.
- **Centre — page preview.** The selected section as it will render: KPI tiles,
  a governed table, and commentary blocks with their review state. Sections with
  no data show an honest "awaiting data" note rather than a blank.
- **Right — settings, AI and governance.** Page settings (source, data status,
  data-through, provenance, source link, warnings); the **AI commentary** panel
  (perspective + detail level → Generate draft); the live **validation
  checklist**; and the **versions** list (each links to a PPTX export of that
  snapshot).

An action bar across the top shows status, the validation verdict, the lifecycle
buttons for the current state, and the export links.

## Add to Report

`app/add-to-report.js` is a small "**+ Add to Report**" widget droppable onto any
dashboard. It saves the underlying **source key + current filters** (never a
screenshot) into an existing draft or a new Weekly Trade Pack, so the report page
refreshes from governed data. It posts to `/api/reports-centre/add-to-report`,
which appends an ad-hoc section plus a component bound to that source.

## Roles

The Centre maps onto the platform's existing roles (`lib/auth.js`, `hasRole`):

| Role | In the Reporting Centre |
|---|---|
| **FINANCE** | Create, build, edit, generate and sign off commentary, run the lifecycle, export. |
| **ADMIN** | Same as FINANCE (superset of platform permissions). |
| **EXEC** | View reports and export; cannot create or edit. |

In this release FINANCE and ADMIN share the full create/review/approve set — the
API gate for every mutation is `hasRole(session, "ADMIN", "FINANCE")`, and EXEC
is view-only (`hasRole(session, "ADMIN", "FINANCE", "EXEC")` to read). A finer
split — FINANCE prepares and reviews while a distinct approver role approves — is
a deliberate fast-follow; the data model already carries separate `reviewer` and
`approver` fields to support it. See the release report for the deferred-scope
note.
