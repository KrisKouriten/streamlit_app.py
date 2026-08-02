/*
 * The governed pages that expose an AI Perspective (CR §4.4, §20 Phase 3). This
 * is the code-side manifest mirroring the intelligence.page_context_registry
 * seed in migration 038 — a pure allow-list so the endpoint can reject an
 * unknown pageId before spending a model call, and so the wired pages and the
 * registry stay in step. The registry remains the source of truth for the
 * page→domains map at runtime; this just guards the entry point.
 */
export const PERSPECTIVE_PAGES = [
  // Phase 3
  { id: "executive",           name: "Executive Intelligence Hub", route: "/finance-os/executive" },
  { id: "management-accounts", name: "Management Accounts",        route: "/finance-os/management-accounts" },
  { id: "store-performance",   name: "Store Performance",          route: "/finance-os/store-sales/league" },
  { id: "forecast",            name: "Forecast Builder",           route: "/operate/forecast" },
  { id: "cash-flow",           name: "Cash Flow",                  route: "/finance-os/cashflow" },
  { id: "inventory",           name: "Inventory",                  route: "/finance-os/inventory" },
  // Phase 4 — wider module coverage
  { id: "procurement",         name: "Procurement",                route: "/operate/procurement" },
  { id: "open-to-buy",         name: "Open-to-Buy",                route: "/plan/otb" },
  { id: "sku-analysis",        name: "SKU Analysis",               route: "/finance-os/sku-analysis" },
  { id: "three-statement",     name: "Three-Statement",            route: "/finance-os/three-statement" },
  { id: "month-end-close",     name: "Month-end Close",            route: "/operate/close" },
  { id: "intercompany",        name: "Intercompany",               route: "/operate/intercompany" },
  { id: "scenarios",           name: "Scenario Planning",          route: "/plan/scenarios" },
  { id: "business-projects",   name: "Business Projects",          route: "/plan/business-projects" },
];

const IDS = new Set(PERSPECTIVE_PAGES.map((p) => p.id));

export function isPerspectivePage(pageId) {
  return IDS.has(String(pageId || ""));
}
