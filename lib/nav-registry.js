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
      { label: "Notifications", slug: "notifications", hint: "Everything that needs you, as it happens" },
      { label: "Global Search", action: "palette", hint: "⌘K — go anywhere, run anything" },
    ],
  },
  {
    key: "dashboards", label: "Dashboards",
    items: [
      { label: "Master Finance Dashboard", slug: "master-finance-dashboard", hint: "The whole finance function on one screen", related: [["Executive Intelligence Hub", "/finance-os/executive"]] },
      { label: "Management Accounts", href: "/finance-os/management-accounts", hint: "Consolidated P&L — real feed" },
      { label: "Budget & Forecast", href: "/finance-os/budget-forecast", hint: "The multi-year plan model" },
      { label: "Store Sales & KPI", href: "/finance-os/store-sales", hint: "Trading across every store" },
      { label: "Company Store Performance", slug: "company-store-performance", hint: "Own-store P&L performance in depth", related: [["Store league", "/finance-os/store-sales/league"], ["Store drilldown", "/finance-os/store-sales/store"]] },
      { label: "Franchise", href: "/finance-os/franchise", hint: "Franchise sales, receivables & credit" },
      { label: "Wholesale", slug: "wholesale-dashboard", hint: "Wholesale revenue, margin and pipeline" },
      { label: "Inventory", href: "/finance-os/inventory", hint: "Stock value, ageing & cover" },
      { label: "Cash Flow", href: "/finance-os/cashflow", hint: "Cash position by entity" },
      { label: "Treasury", slug: "treasury-dashboard", hint: "Facilities, funding and forward cash", related: [["Cash Flow", "/finance-os/cashflow"]] },
      { label: "Fixed Assets", href: "/finance-os/fixed-assets", hint: "The asset register" },
      { label: "Purchase Order & Procurement", slug: "po-procurement-dashboard", hint: "Commitments, POs and supplier spend" },
      { label: "Department Budget", slug: "department-budget-dashboard", hint: "Budgets and burn by department" },
      { label: "Project Budget", slug: "project-budget-dashboard", hint: "Budgets and burn by project" },
      { label: "Weighted Average Cost", slug: "wac-dashboard", hint: "WAC by line across the stock pool" },
      { label: "Finance Operations", slug: "finance-operations-dashboard", hint: "Throughput and health of the finance engine" },
      { label: "Month-End Close", href: "/operate/month-end", hint: "Per-entity close status board" },
      { label: "Digital Finance Team", slug: "dft-dashboard", hint: "The agents' output, accuracy and value", related: [["Agent Centre", "/ai"]] },
      { label: "Finance Data Quality", slug: "data-quality-dashboard", hint: "Completeness, freshness and exceptions by feed" },
      { label: "Controls & Governance", slug: "controls-dashboard", hint: "Control health, sign-offs and audit posture", related: [["Govern hub", "/govern"]] },
    ],
  },
  {
    key: "plan", label: "Plan",
    items: [
      { label: "Budget Builder", slug: "budget-builder", hint: "Build the budget bottom-up, version by version" },
      { label: "Forecast Builder", href: "/operate/forecast", hint: "Forecast inputs — stores, head office, franchise" },
      { label: "Scenario Planning", href: "/plan/scenarios", hint: "Upside / base / downside on the forecast inputs" },
      { label: "Store Planning", slug: "store-planning", hint: "New stores, closures and store-level plans" },
      { label: "Wholesale Planning", slug: "wholesale-planning", hint: "Wholesale volumes, pricing and margin plans" },
      { label: "Franchise Planning", slug: "franchise-planning", hint: "Franchise pipeline and fee plans" },
      { label: "Department Budgets", slug: "department-budgets", hint: "Departmental budget entry and ownership" },
      { label: "Project Budgets", slug: "project-budgets", hint: "Project budget entry and tracking" },
      { label: "Consolidated P&L", slug: "consolidated-pl", hint: "The planned P&L, consolidated across scopes", related: [["Budget & Forecast", "/finance-os/budget-forecast"]] },
    ],
  },
  {
    key: "perform", label: "Perform",
    items: [
      { label: "Management Accounts", href: "/finance-os/management-accounts", hint: "Actuals vs plan — the monthly read" },
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
      { label: "Month-End Close", href: "/operate/month-end", hint: "Every entity's close tasks — owner, status, summary" },
      { label: "Management Accounts Close", href: "/operate/management-close", hint: "Pre-close checks & the reconciliation playbook" },
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
      { label: "Chart of Accounts", slug: "chart-of-accounts", hint: "The nominal structure, mastered" },
      { label: "Entities", href: "/govern/entities", hint: "The group's legal entities" },
      { label: "Stores", slug: "stores-master", hint: "Store master — openings, closures, attributes" },
      { label: "Departments", slug: "departments-master", hint: "Department master" },
      { label: "Projects", slug: "projects-master", hint: "Project master" },
      { label: "Cost Centres", slug: "cost-centres", hint: "Cost-centre master" },
      { label: "Suppliers", slug: "suppliers-master", hint: "Supplier master" },
      { label: "Customers", slug: "customers-master", hint: "Customer master" },
      { label: "Franchisees", slug: "franchisees-master", hint: "Franchisee master and agreements" },
      { label: "Budget Versions", slug: "budget-versions", hint: "Versioned budgets — locked and labelled" },
      { label: "Forecast Versions", slug: "forecast-versions", hint: "Versioned forecasts — locked and labelled" },
      { label: "Exchange Rates", slug: "exchange-rates", hint: "FX rates by period" },
      { label: "KPI Definitions", slug: "kpi-definitions", hint: "The governed KPI catalogue" },
      { label: "Allocation Rules", slug: "allocation-rules", hint: "How shared costs are allocated" },
    ],
  },
  {
    key: "govern", label: "Govern",
    items: [
      { label: "Users & Roles", href: "/govern/users", hint: "Access control" },
      { label: "Permissions", slug: "permissions", hint: "What each role can do, explicitly" },
      { label: "Approvals", slug: "approvals", hint: "One approvals inbox across the platform", related: [["Task Review Queue", "/perform/review"], ["Agent Reviews", "/ai/review"]] },
      { label: "Controls", slug: "controls", hint: "The control library and its operation" },
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
  plan: ["Planning module", "Data entry & forecasting"],
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
  // "wholesale-dashboard": "/finance-os/wholesale",
};

// Milestones & dependencies for planned modules (professional placeholders).
const DEFAULT_META = { milestone: "Scheduled — sequenced in the build plan", deps: ["Module design sign-off", "Data feed connection"] };
export const PLANNED_META = {
  "my-finance-home": { milestone: "Build wave A", deps: ["Notification store", "Task + review feeds (live)"] },
  "notifications": { milestone: "Build wave A", deps: ["Notification store", "Event triggers from audit log"] },
  "budget-builder": { milestone: "Build wave A", deps: ["Budget version schema", "Forecast inputs (live)"] },
  "consolidated-pl": { milestone: "Build wave A", deps: ["Forecast inputs (live)", "Joiin actuals feed (live)"] },
  "company-store-performance": { milestone: "Build wave A", deps: ["Store P&L grain (forecast inputs live)", "Joiin store-level actuals"] },
  "wholesale-dashboard": { milestone: "Build wave B", deps: ["Wholesale income model", "Joiin HO/FR wholesale lines (live)"] },
  "wholesale-planning": { milestone: "Build wave B", deps: ["Wholesale income model"] },
  "wholesale-performance": { milestone: "Build wave B", deps: ["Wholesale income model", "Joiin actuals feed (live)"] },
  "treasury-dashboard": { milestone: "Build wave B", deps: ["Treasury / bank facility feed"] },
  "treasury-performance": { milestone: "Build wave B", deps: ["Treasury / bank facility feed"] },
  "po-procurement-dashboard": { milestone: "Build wave B", deps: ["Purchase order data source"] },
  "po-tracker": { milestone: "Build wave B", deps: ["Purchase order data source", "Approval rules"] },
  "wac": { milestone: "Build wave C", deps: ["Inventory movement feed", "Stock roll-forward (process defined)"] },
  "wac-dashboard": { milestone: "Build wave C", deps: ["Weighted Average Cost engine (Operate)"] },
  "audit-trail": { milestone: "Build wave B", deps: ["Audit log (data live — screen pending)"] },
  "data-quality": { milestone: "Build wave B", deps: ["Feed metadata (live)", "Exception rules"] },
  "approvals": { milestone: "Build wave B", deps: ["Task review queue (live)", "Agent reviews (live)"] },
  "kpi-definitions": { milestone: "Build wave B", deps: ["KPI catalogue (data live — screen pending)"] },
  "chart-of-accounts": { milestone: "Build wave B", deps: ["Account dimension (data live — screen pending)"] },
  "stores-master": { milestone: "Build wave B", deps: ["Store dimension (data live — screen pending)"] },
};

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
