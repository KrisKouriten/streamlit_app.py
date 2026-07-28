# Finance Data Intake — Blueprint

**Status:** structural shell live; feed parsers to be built as formats are finalised.
Refers to the operating company as **Miniso UK** (house style).

## Vision

One governed intake under **FINANCE DATA → Data Uploads** (`/data/uploads`): every
Excel or agent-delivered input is loaded in **one location** and flows through the
whole platform — dashboards, Management Accounts (Perform), the month-end close and
the Corporate Reporting Centre. No screen keys figures by hand; each upload writes a
governed table that everything else reads. Where a feed's format isn't pinned yet the
hub shows it honestly as *awaiting format* rather than displaying invented numbers.

Govern is left **controls-only**. The former "P&L Formats" screen is re-homed to
Finance Data and renamed **Financial Statements Upload & Refresh** (route unchanged).

## The feeds

| Feed | Status | Governed table (grain) | Drives | Notes |
|---|---|---|---|---|
| **Financial Statements Upload & Refresh** | **Live** | `finance.joiin_pl_entity`, `finance.joiin_boardpack` (scope × ym × line), `finance.joiin_bs`, `finance.pl_format` | Board-pack MA, three-statement, Executive Hub, Reporting Centre statutory sections | Joiin API refresh + by-company workbook + format templates |
| **Management Accounts — Actuals** | **Live** | `finance.mgmt_actual` (Entity · Store · Month · Nominal · Value) | MA blend (Perform), Company Store Performance, Reporting Centre, MA Close checks | **CY and PY uploaded separately** (each a set of months); actuals lead each month they cover, forecast carries the rest |
| **Budget & Forecast** | **Live** | `finance.forecast_line` / versions | All budget/forecast comparatives | Plan model workbook; Forecast Builder under Operate |
| **Sales data** | **To build** | new `commercial.fact_store_sales` self-serve load | All store sales & KPI reports | Currently loaded outside the app — needs an in-app uploader for the period export |
| **Inventory** | **To build** | new `operations.fact_inventory` | Inventory dashboard (value, ageing, cover) | Awaiting stock feed format |
| **Treasury** | **To build** | new `finance.fact_treasury` (balances, facility limit, drawn, headroom, forward flows) | Treasury dashboard, Cash & Treasury report perspective | Awaiting bank-facility / forward-cash feed |
| **Fixed & Variable cost tagging** | **To build** | new `finance.cost_classification` (nominal → FIXED/VARIABLE + basis) | **Benchmarks the MA Close analysis** — variance split + AI accrual recommendations (SOP §5.6) | The classification that lets step 2 of the close reason about fixed vs variable drift |

## How the cost split feeds the close (SOP §5.6)

Step **2 · Management Accounts Close** already runs completeness / variable-drift /
fixed-drift / sign checks. Today the fixed-vs-variable split is implicit. Once the
**cost-classification** input is loaded, each nominal carries a FIXED/VARIABLE tag and
an expected basis, so the close can:
1. split the period variance into fixed and variable components,
2. compare each against its expected basis (e.g. variable vs sales, fixed vs plan),
3. put forward a **governed AI accrual recommendation** — a draft for human sign-off,
   never auto-posted (reuses the Finance Intelligence Layer).

## Build sequencing (when formats are ready)

1. **Store-level MA actuals upload** (CY + PY) is already live — confirm it carries the
   store-level P&L for Miniso UK company and Franchise, or extend its grain.
2. **Sales uploader** — unlocks self-serve trading loads.
3. **Fixed/Variable classification** — unlocks the MA Close benchmark + AI accruals.
4. **Inventory**, then **Treasury** — unlock those dashboards and report perspectives.

## What I need from you per new feed

For each *to-build* feed, the exact **column layout** of the Excel (headers, grain,
one row = what, and whether values are period or cumulative). With that I build: a
migration for the governed table, a pure parser + tests, the uploader UI in the hub,
and wire the adapters/dashboards to read it.
