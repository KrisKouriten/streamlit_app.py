/*
 * The navigation registry — single source of truth for the persistent sidebar,
 * the ⌘K command palette and the planned-module pages. Pure data, client-safe.
 *
 * status: "LIVE" (existing screen; href is its current route — routes are never
 * renamed here) or "PLANNED" (renders at /module/<slug> with purpose + related
 * live modules until built). Overlaps are documented, never auto-merged — see
 * docs/navigation-migration.md for the migration protocol and recommendations.
 */

export const NAV_SECTIONS = [
  {
    key: "home", label: "Home",
    items: [
      { label: "Executive Intelligence Hub", href: "/finance-os/executive", hint: "The connected sphere — position & attention" },
      { label: "My Finance Home", slug: "my-finance-home", hint: "Your day, tasks, reviews and mentions in one place", related: [["My Finance Week", "/perform/my-week"]] },
      { label: "Corporate Reporting Centre", href: "/finance-os/home/reports", hint: "Governed reporting decks from live Finance OS data, approved commentary and AI intelligence" },
      { label: "Notifications", href: "/inbox", hint: "Everything that needs you, as it happens" },
      { label: "Proactive Briefings", href: "/finance-os/briefings", hint: "The governed finance brief — pushed to you, no one has to ask" },
      { label: "Drafted Commentary", href: "/finance-os/commentary", hint: "AI-drafted narrative over governed figures, for human sign-off" },
      { label: "Benefit Realisation", href: "/finance-os/benefit-realisation", hint: "Expected vs realised £ on AI-recommended actions" },
      { label: "Global Search", action: "palette", hint: "⌘K — go anywhere, run anything" },
    ],
  },
  {
    // Dashboards are outward, read-only reports: every figure is driven by the
    // upstream flow (Plan — Finance → … → Govern), never keyed here. Operational
    // and input-bearing views (WAC, month-end close) live under Operate; other
    // reports are held back from the sidebar until they earn a place here.
    key: "dashboards", label: "Dashboards",
    items: [
      { label: "Master Finance Dashboard", slug: "master-finance-dashboard", hint: "The whole finance function on one screen", related: [["Executive Intelligence Hub", "/finance-os/executive"]] },
      { label: "Management Accounts Dashboard", href: "/dashboards/management-accounts", hint: "Actual vs forecast — Revenue & EBITDA by scope" },
      { label: "Budget & Forecast Dashboard", href: "/finance-os/budget-forecast", hint: "The multi-year plan model" },
      { label: "Store Sales & KPI Dashboard", href: "/finance-os/store-sales", hint: "Trading across every store" },
      { label: "Company Store Performance Dashboard", slug: "company-store-performance", hint: "Own-store P&L performance in depth", related: [["Store league", "/finance-os/store-sales/league"], ["Store drilldown", "/finance-os/store-sales/store"]] },
      { label: "Franchise Dashboard", href: "/finance-os/franchise", hint: "Franchise sales, receivables & credit" },
      { label: "Inventory Dashboard", href: "/finance-os/inventory", hint: "Stock value, ageing & cover" },
      { label: "Treasury Dashboard", slug: "treasury-dashboard", hint: "Facilities, funding and forward cash", related: [["Cash Flow", "/finance-os/cashflow"]] },
      { label: "Departmental Budget Dashboard", slug: "department-budget-dashboard", hint: "Budgets and burn by department" },
      { label: "Projects Dashboard", slug: "project-budget-dashboard", hint: "Budgets and burn by project" },
    ],
  },
  {
    // Finance-only planning. `restrictedTo` is a forward hook — when non-finance
    // users are created, the sidebar/route guard hides this section from them
    // (enforcement wired separately; today all users are finance/admin).
    key: "plan-finance", label: "Plan — Finance", restrictedTo: ["ADMIN", "FINANCE"],
    items: [
      { label: "Budget Builder", slug: "budget-builder", hint: "Build the budget bottom-up, version by version" },
      { label: "Forecast Builder", href: "/operate/forecast", hint: "Forecast inputs — stores, head office, franchise" },
      { label: "Scenario Planning", href: "/plan/scenarios", hint: "Upside / base / downside on the forecast inputs" },
      { label: "Store Planning", slug: "store-planning", hint: "New stores, closures and store-level plans" },
      { label: "Franchise Planning", slug: "franchise-planning", hint: "Franchise pipeline and fee plans" },
      { label: "Project Budgets", slug: "project-budgets", hint: "Project budget entry and tracking" },
      { label: "Consolidated P&L", slug: "consolidated-pl", hint: "The planned P&L, consolidated across scopes", related: [["Budget & Forecast", "/finance-os/budget-forecast"]] },
    ],
  },
  {
    // Head-office planning, usable by non-finance business users.
    key: "plan-ho", label: "Plan — HO",
    items: [
      { label: "Pricing Review", slug: "pricing-review", hint: "Review and set retail pricing across the range" },
      { label: "Inventory Planning", slug: "inventory-planning", hint: "Plan stock intake, cover and replenishment" },
      { label: "P.O Review", slug: "po-review", hint: "Review purchase orders before commitment" },
      { label: "Procurement", href: "/operate/procurement", hint: "Miniso & local purchases — monthly cash budget vs committed spend" },
      { label: "Business Projects", href: "/plan/business-projects", hint: "Cross-functional business change projects" },
      { label: "OTB Planning", slug: "otb-planning", hint: "Open-to-buy planning by category and season" },
      { label: "Departmental Budgets", slug: "department-budgets", hint: "Departmental budget entry and ownership" },
    ],
  },
  {
    key: "perform", label: "Perform",
    items: [
      { label: "Management Accounts", href: "/finance-os/management-accounts", hint: "Actuals vs plan — the monthly read" },
      { label: "Three-Statement Model", href: "/finance-os/three-statement", hint: "P&L, Balance Sheet & a linked, reconciled Cash Flow" },
      { label: "Store Performance", href: "/finance-os/store-sales/league", hint: "Ranked store performance" },
      { label: "Wholesale Performance", slug: "wholesale-performance", hint: "Wholesale actuals vs plan" },
      { label: "Franchise Performance", href: "/finance-os/franchise", hint: "Franchise actuals and exposure" },
      { label: "Inventory", href: "/finance-os/inventory", hint: "Stock health at working grain" },
      { label: "Cash Flow", href: "/finance-os/cashflow", hint: "Cash performance by entity" },
      { label: "Treasury", slug: "treasury-performance", hint: "Facility usage and funding performance", related: [["Cash Flow", "/finance-os/cashflow"]] },
      { label: "Fixed Assets", href: "/finance-os/fixed-assets", hint: "Asset base, depreciation and return" },
      { label: "Procurement Performance", slug: "procurement-performance", hint: "Supplier spend vs commitments" },
    ],
  },
  {
    key: "operate", label: "Operate",
    items: [
      { label: "My Finance Week", href: "/perform/my-week", hint: "Your tasks this week" },
      { label: "Finance Team Schedule", href: "/perform/schedule", hint: "Workload & allocation" },
      // The month-end close is one process in three numbered steps (see SOP §5.6):
      // 1 do the per-entity work · 2 reconcile & decide accruals · 3 confirm readiness & lock.
      { label: "1 · Month-End Close", href: "/operate/month-end", hint: "Step 1 — every entity's close tasks: owner, status, summary" },
      { label: "2 · Management Accounts Close", href: "/operate/management-close", hint: "Step 2 — reconciliation: variance checks, confirm·correct·explain, accruals" },
      { label: "3 · Close Cockpit", href: "/operate/close", hint: "Step 3 — readiness gates & the lock / reopen control" },
      { label: "Purchase Order Tracker", slug: "po-tracker", hint: "Raise, approve and match POs" },
      { label: "Weighted Average Cost", slug: "wac", hint: "Maintain the WAC engine and its inputs" },
      { label: "Action Centre", href: "/govern/actions", hint: "Follow-through on decisions" },
      { label: "Finance Projects", slug: "finance-projects", hint: "The function's own change projects" },
      { label: "Intercompany", href: "/operate/intercompany", hint: "Cash · inventory & recharges · disbursements" },
      { label: "Task Review Queue", href: "/perform/review", hint: "Approve or return submitted work" },
      { label: "Task Library", href: "/perform/library", hint: "Recurring templates" },
    ],
  },
  {
    key: "dft", label: "Digital Finance Team",
    items: [
      { label: "Chief Finance Intelligence", slug: "chief-finance-intelligence", hint: "The orchestrating agent over the function" },
      { label: "FP&A Master", slug: "fpa-master", hint: "Planning & analysis agent" },
      { label: "Finance Operations Master", slug: "finance-operations-master", hint: "Close, recs and operations agent" },
      { label: "Commercial Finance Master", slug: "commercial-finance-master", hint: "Trading and commercial agent" },
      { label: "Finance Governance Master", slug: "finance-governance-master", hint: "Controls and compliance agent" },
      { label: "Finance Data Master", slug: "finance-data-master", hint: "Data quality and mastering agent" },
      { label: "Executive Reporting Master", slug: "executive-reporting-master", hint: "Board and executive reporting agent" },
      { label: "Agent Activity", href: "/ai", hint: "Runs, outputs and controls" },
      { label: "Agent Reviews", href: "/ai/review", hint: "Outputs awaiting a person" },
      { label: "Agent Exceptions", slug: "agent-exceptions", hint: "Where agents flagged or failed", related: [["Agent Centre", "/ai"]] },
      { label: "AI Benefits", href: "/govern/benefits", hint: "Realised value from the agents" },
    ],
  },
  {
    key: "data", label: "Finance Data",
    items: [
      { label: "Data Uploads", href: "/data/uploads", hint: "One place to load every governed input — statements, actuals, sales, inventory, treasury, costs" },
      { label: "Financial Statements Upload & Refresh", href: "/govern/pl-formats", hint: "Board-pack P&L layouts, nominal mapping & the Joiin statutory refresh" },
      { label: "Master Data", href: "/data/master", hint: "The governed dimensions — one home, with lineage" },
      { label: "Chart of Accounts", slug: "chart-of-accounts", hint: "The nominal structure, mastered" },
      { label: "Entities", href: "/govern/entities", hint: "The group's legal entities" },
      { label: "Stores", slug: "stores-master", hint: "Store master — openings, closures, attributes" },
      { label: "Departments", slug: "departments-master", hint: "Department master" },
      { label: "Projects", slug: "projects-master", hint: "Project master" },
      { label: "Cost Centres", slug: "cost-centres", hint: "Cost-centre master" },
      { label: "Suppliers", slug: "suppliers-master", hint: "Supplier master" },
      { label: "Customers", slug: "customers-master", hint: "Customer master" },
      { label: "Franchisees", slug: "franchisees-master", hint: "Franchisee master and agreements" },
      { label: "Budget Versions", href: "/data/versions?kind=BUDGET", hint: "Versioned budgets — locked and labelled" },
      { label: "Forecast Versions", href: "/data/versions?kind=FORECAST", hint: "Versioned forecasts — locked and labelled" },
      { label: "Exchange Rates", slug: "exchange-rates", hint: "FX rates by period" },
      { label: "KPI Definitions", slug: "kpi-definitions", hint: "The governed KPI catalogue" },
      { label: "Allocation Rules", slug: "allocation-rules", hint: "How shared costs are allocated" },
    ],
  },
  {
    key: "govern", label: "Govern",
    items: [
      { label: "Users, Roles & Permissions", href: "/govern/users", hint: "Users, roles, department sign-off and page access" },
      { label: "Approvals", slug: "approvals", hint: "One approvals inbox across the platform", related: [["Task Review Queue", "/perform/review"], ["Agent Reviews", "/ai/review"]] },
      { label: "Controls", slug: "controls", hint: "The control library and its operation" },
      { label: "Report Builder", href: "/reports", hint: "Save & export your own reports across the finance datasets" },
      { label: "SOP Library", href: "/handbook", hint: "The operating manual" },
      { label: "Data Quality", slug: "data-quality", hint: "Feed completeness and exception rules" },
      { label: "Audit Trail", slug: "audit-trail", hint: "Every state change, queryable" },
      { label: "System Settings", slug: "system-settings", hint: "Platform configuration" },
    ],
  },
];

/* Module kinds — the platform distinguishes what each module is FOR. Derived
   from its section so navigation components never carry calculations. */
export const MODULE_KINDS = {
  home: ["Personal workspace", "Your day and what needs you"],
  dashboards: ["Dashboard view", "Reporting & analysis — read, don't key"],
  "plan-finance": ["Planning module", "Finance planning — data entry & forecasting"],
  "plan-ho": ["Planning module", "Head-office planning — pricing, stock, POs and budgets"],
  perform: ["Performance module", "Detailed analysis against plan"],
  operate: ["Operating module", "Complete finance processes"],
  dft: ["Digital finance team", "Governed agents and their output"],
  data: ["Master data", "The governed dimensions everything joins to"],
  govern: ["Governance module", "Access, controls and audit"],
};

/* Feature flags for incomplete modules: flipping a slug to a route here makes
   it live everywhere (sidebar, palette, planned page redirect target) with no
   structural change. Empty by default — planned modules stay planned. */
export const MODULE_FLAGS = {
  "kpi-definitions": "/govern/kpi-definitions",
  // Dashboards wired to real upstream data (Plan — Finance → … → Govern).
  "master-finance-dashboard": "/dashboards/master-finance",
  "company-store-performance": "/dashboards/company-store-performance",
  "project-budget-dashboard": "/dashboards/projects",
  "po-tracker": "/operate/po-tracker",
  "department-budgets": "/plan/dept-budget",
};

// Milestones & dependencies for planned modules (professional placeholders).
const DEFAULT_META = { milestone: "Scheduled — sequenced in the build plan", deps: ["Module design sign-off", "Data feed connection"] };
export const PLANNED_META = {
  "my-finance-home": { milestone: "Build wave A", deps: ["Notification store", "Task + review feeds (live)"] },
  "budget-builder": { milestone: "Build wave A", deps: ["Budget version schema", "Forecast inputs (live)"] },
  "consolidated-pl": { milestone: "Build wave A", deps: ["Forecast inputs (live)", "Joiin actuals feed (live)"] },
  "company-store-performance": { milestone: "Build wave A", deps: ["Store P&L grain (forecast inputs live)", "Joiin store-level actuals"] },
  "wholesale-planning": { milestone: "Build wave B", deps: ["Wholesale income model"] },
  "wholesale-performance": { milestone: "Build wave B", deps: ["Wholesale income model", "Joiin actuals feed (live)"] },
  "treasury-dashboard": { milestone: "Build wave B", deps: ["Treasury / bank facility feed"] },
  "treasury-performance": { milestone: "Build wave B", deps: ["Treasury / bank facility feed"] },
  "po-tracker": { milestone: "Build wave B", deps: ["Purchase order data source", "Approval rules"] },
  "wac": { milestone: "Build wave C", deps: ["Inventory movement feed", "Stock roll-forward (process defined)"] },
  "audit-trail": { milestone: "Build wave B", deps: ["Audit log (data live — screen pending)"] },
  "data-quality": { milestone: "Build wave B", deps: ["Feed metadata (live)", "Exception rules"] },
  "approvals": { milestone: "Build wave B", deps: ["Task review queue (live)", "Agent reviews (live)"] },
  "kpi-definitions": { milestone: "Build wave B", deps: ["KPI catalogue (data live — screen pending)"] },
  "chart-of-accounts": { milestone: "Build wave B", deps: ["Account dimension (data live — screen pending)"] },
  "stores-master": { milestone: "Build wave B", deps: ["Store dimension (data live — screen pending)"] },
  "pricing-review": { milestone: "Build wave B", deps: ["SKU price + margin master", "Sell-through feed (SKU analysis live)"] },
  "inventory-planning": { milestone: "Build wave B", deps: ["Stock + cover feed", "Sales forecast (forecast inputs live)"] },
  "po-review": { milestone: "Build wave B", deps: ["Purchase order data source", "Approval rules"] },
  "otb-planning": { milestone: "Build wave B", deps: ["Open-to-buy model", "Category / season plan"] },
  "business-projects": { milestone: "Build wave B", deps: ["Project register", "Departmental budgets"] },
};

export function findSection(key) {
  const s = NAV_SECTIONS.find((x) => x.key === key);
  if (!s) return null;
  return { ...s, kind: MODULE_KINDS[s.key] };
}

export function findModule(slug) {
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      if (it.slug === slug) {
        const meta = PLANNED_META[slug] || DEFAULT_META;
        return { ...it, ...meta, section: s.label, sectionKey: s.key, kind: MODULE_KINDS[s.key], live: !!MODULE_FLAGS[slug] };
      }
    }
  }
  return null;
}

// The one place a nav item's destination is decided (feature-flag aware).
export function resolveHref(it) {
  if (it.href) return it.href;
  if (it.slug) return MODULE_FLAGS[it.slug] || `/module/${it.slug}`;
  return null;
}

// Longest-prefix match so e.g. /finance-os/store-sales/league can highlight
// its own entry rather than the store-sales one.
export function activeHref(path) {
  let best = null, bestLen = -1;
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      const h = resolveHref(it);
      if (h && path.startsWith(h) && h.length > bestLen) { best = h; bestLen = h.length; }
    }
  }
  return best;
}
