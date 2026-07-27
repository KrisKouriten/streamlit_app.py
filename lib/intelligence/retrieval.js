import { makeSource } from "./source-rules";
import { mayCompareAcrossScope } from "./permission-rules";
import { getFreshness } from "../governance";
import {
  getRealFinanceSnapshot,
  getInventoryHealth,
  getRealCashPosition,
  getCashPosition,
  getManagementVariance,
} from "../finance-os";
import { getWindows, getPeriodSummary } from "../store-sales";
// Phase 4 — wider module coverage. Each maps to an existing governed service.
import { getProcurement } from "../procurement";
import { getSkuAnalysis } from "../sku";
import { getThreeStatement } from "../threestatement";
import { getCloseBoard } from "../close";
import { getPreclose } from "../preclose";
import { getSummary as getIntercompanySummary, CATEGORIES as IC_CATEGORIES } from "../intercompany";
import { getForecast } from "../forecast";
import { getBusinessProjects } from "../business-projects";

/*
 * Permission-aware retrieval — the calculation adapter (CR §2, §6). Each domain
 * calls an EXISTING governed calculation service and returns { facts, sources }.
 * The AI never recomputes a governed figure; it receives these as facts.
 *
 * Every fetcher is wrapped so a service that isn't populated yet degrades to a
 * "missing source" warning (which the confidence framework then reflects as LOW)
 * rather than crashing the request. Scope is checked first: a session with no
 * finance visibility gets nothing but an honest limitation.
 */

// facts: [{ label, value(number|null), unit, display }]  — value drives claim validation.
function fact(label, value, unit = "£", display = null) {
  return { label, value: Number.isFinite(value) ? value : null, unit, display: display ?? null };
}

async function freshnessISO(dashboardCode) {
  try {
    const f = await getFreshness(dashboardCode);
    return f?.completed_at ? new Date(f.completed_at).toISOString() : null;
  } catch {
    return null;
  }
}

const DOMAIN_FETCHERS = {
  finance_snapshot: async () => {
    const s = await getRealFinanceSnapshot();
    if (!s) return missing("Consolidated P&L", "finance_snapshot");
    const dataThrough = s.asAt ? new Date(s.asAt).toISOString() : await freshnessISO(null);
    return {
      facts: [
        fact("Revenue", s.revenue),
        fact("Gross profit", s.grossProfit),
        fact("Gross margin %", s.grossMargin != null ? Math.round(s.grossMargin * 1000) / 10 : null, "%"),
        fact("Net result", s.netResult),
        fact("Cash", s.cash),
      ].filter((f) => f.value != null),
      sources: [makeSource({ module: "Consolidated P&L (Joiin)", service: "getRealFinanceSnapshot", dataThrough, route: "/finance-os/executive" })],
    };
  },

  management_accounts: async () => {
    const rows = await getManagementVariance();
    if (!rows || !rows.length) return missing("Management Accounts", "management_accounts");
    return {
      facts: [fact("Management-accounts variance lines", rows.length, "count")],
      sources: [makeSource({ module: "Management Accounts", service: "getManagementVariance", dataThrough: await freshnessISO(null), route: "/finance-os/management-accounts" })],
      // Variance vs a working forecast — flag it so confidence never over-claims.
      flags: { hasUnapprovedForecast: true },
    };
  },

  store_performance: async (scope) => {
    const win = await getWindows();
    if (!win) return missing("Store Sales & KPI", "store_performance");
    const ytd = await getPeriodSummary(win.ytd || win);
    const dataThrough = await freshnessISO("STORE_SALES_KPI");
    const facts = [];
    if (ytd) {
      if (ytd.net != null) facts.push(fact("YTD net sales", ytd.net));
      if (ytd.gm != null) facts.push(fact("YTD gross margin", ytd.gm));
    }
    const out = {
      facts,
      sources: [makeSource({ module: "Store Sales & KPI", service: "getPeriodSummary", dataThrough, route: "/finance-os/store-sales/league" })],
    };
    // A ranking/league is a cross-store comparison — only offer it in scope (CR §9).
    if (!mayCompareAcrossScope(scope)) out.warnings = ["Store rankings withheld — this account is not cleared for a cross-store comparison."];
    return out;
  },

  cash: async () => {
    let c = null;
    try { c = await getRealCashPosition(); } catch { c = null; }
    if (!c) { try { c = await getCashPosition(); } catch { c = null; } }
    if (!c) return missing("Cash flow", "cash");
    return {
      facts: [],
      sources: [makeSource({ module: "Cash Flow", service: "getRealCashPosition", dataThrough: await freshnessISO(null), route: "/finance-os/cashflow" })],
    };
  },

  inventory: async () => {
    const h = await getInventoryHealth();
    if (!h) return missing("Inventory", "inventory");
    return {
      facts: [],
      sources: [makeSource({ module: "Inventory", service: "getInventoryHealth", dataThrough: await freshnessISO(null), route: "/finance-os/inventory" })],
    };
  },

  // ---- Phase 4: Trading & commercial ----
  procurement: async () => {
    const p = await getProcurement();
    if (!p || !p.loaded || !p.summary) return missing("Procurement", "procurement");
    const bySource = Object.values(p.summary);
    const committed = bySource.reduce((s, x) => s + (x.totalCommitted || 0), 0);
    const budget = bySource.reduce((s, x) => s + (x.totalBudget || 0), 0);
    const facts = [fact("Committed procurement spend", committed)];
    if (budget) {
      facts.push(fact("Procurement budget", budget));
      facts.push(fact("Budget headroom", budget - committed));
    }
    const out = {
      facts: facts.filter((f) => f.value != null),
      sources: [makeSource({ module: "Procurement", service: "getProcurement", dataThrough: await freshnessISO(null), route: "/operate/procurement" })],
    };
    if (p.illustrative) out.warnings = ["Procurement figures are an illustrative seed — not a real load yet."];
    return out;
  },

  sku: async () => {
    const s = await getSkuAnalysis();
    if (!s || !s.loaded) return missing("SKU Analysis", "sku");
    const dormantValue = (s.dormant || []).reduce((a, r) => a + (Number(r.stock_value) || 0), 0);
    const facts = [
      fact("SKUs analysed", s.count, "count"),
      fact("TTM revenue (ranked SKUs)", s.pareto?.total),
      fact("A-class SKUs (top 80% of revenue)", s.pareto?.aCount, "count"),
      fact("New SKUs (launch window)", (s.newSkus || []).length, "count"),
      fact("Dormant SKUs", (s.dormant || []).length, "count"),
      fact("Dormant stock value", dormantValue),
    ].filter((f) => f.value != null);
    const out = { facts, sources: [makeSource({ module: "SKU Analysis", service: "getSkuAnalysis", period: s.asOf || null, dataThrough: await freshnessISO(null), route: "/finance-os/sku-analysis" })] };
    if (s.illustrative) out.warnings = ["SKU figures are an illustrative seed — not a real load yet."];
    return out;
  },

  // ---- Phase 4: Position & close ----
  three_statement: async () => {
    const t = await getThreeStatement();
    if (!t || (!t.bsReady && !t.cf)) return missing("Three-Statement", "three_statement");
    const facts = [];
    if (t.cf) {
      facts.push(fact("Net profit (period)", t.cf.operating?.netProfit));
      facts.push(fact("Closing cash", t.cf.closingCash));
      facts.push(fact("Net cash movement", t.cf.netMovement));
    }
    const out = {
      facts: facts.filter((f) => f.value != null),
      sources: [makeSource({ module: "Three-Statement (Joiin BS + board pack)", service: "getThreeStatement", period: t.ym || null, dataThrough: await freshnessISO(null), route: "/finance-os/three-statement" })],
    };
    if (t.cf && !t.cf.reconciles) out.warnings = ["The indirect cash flow does not fully reconcile to the balance-sheet cash movement — treat with caution."];
    return out;
  },

  close_status: async () => {
    let board = null, pre = null;
    try { board = await getCloseBoard(); } catch { board = null; }
    try { pre = await getPreclose(); } catch { pre = null; }
    if ((!board || !board.ready) && (!pre || !pre.ready)) return missing("Month-end close", "close_status");
    const facts = [];
    if (pre) {
      facts.push(fact("Pre-close exceptions open", (pre.exceptions || []).length, "count"));
      if (pre.revenueActual != null) facts.push(fact("Revenue (period actual)", pre.revenueActual));
    }
    return {
      facts: facts.filter((f) => f.value != null),
      sources: [makeSource({ module: "Month-end Close", service: "getCloseBoard", period: board?.period || pre?.period || null, dataThrough: await freshnessISO(null), route: "/operate/close" })],
    };
  },

  intercompany: async () => {
    let total = 0, n = 0, reconciled = 0, any = false;
    for (const c of Object.keys(IC_CATEGORIES)) {
      try {
        const s = await getIntercompanySummary(c);
        if (s) { any = true; total += Number(s.total) || 0; n += Number(s.n) || 0; reconciled += Number(s.bs_reconciled) || 0; }
      } catch { /* table not present yet — treated as missing below */ }
    }
    if (!any || n === 0) return missing("Intercompany", "intercompany");
    return {
      facts: [
        fact("Intercompany transactions", n, "count"),
        fact("Intercompany gross value", total),
        fact("Balance-sheet reconciled", reconciled, "count"),
      ].filter((f) => f.value != null),
      sources: [makeSource({ module: "Intercompany", service: "getSummary", dataThrough: await freshnessISO(null), route: "/operate/intercompany" })],
    };
  },

  // ---- Phase 4: Planning ----
  scenarios: async () => {
    const fc = await getForecast();
    if (!fc || !fc.loaded || !fc.base) return missing("Scenario planning", "scenarios");
    const g = fc.base.group?.totals || {};
    return {
      facts: [
        fact("Forecast sales (FY, base)", g.sales),
        fact("Forecast EBITDA (FY, base)", g.ebitda),
        fact("Saved scenarios", (fc.scenarios || []).length, "count"),
      ].filter((f) => f.value != null),
      sources: [makeSource({ module: "Scenario planning", service: "getForecast", dataThrough: await freshnessISO(null), route: "/plan/scenarios" })],
      // A working forecast — flag it so confidence never labels it approved.
      flags: { hasUnapprovedForecast: true },
    };
  },

  business_projects: async () => {
    const b = await getBusinessProjects();
    if (!b || !b.ready || !b.projects?.length) return missing("Business Projects", "business_projects");
    const active = b.projects.filter((p) => p.status === "Active").length;
    const red = b.projects.filter((p) => p.rag === "red").length;
    const budget = b.projects.reduce((s, p) => s + (p.budget || 0), 0);
    return {
      facts: [
        fact("Business projects", b.projects.length, "count"),
        fact("Active projects", active, "count"),
        fact("Projects flagged red", red, "count"),
        fact("Total project budget", budget),
      ].filter((f) => f.value != null),
      sources: [makeSource({ module: "Business Projects", service: "getBusinessProjects", route: "/plan/business-projects" })],
    };
  },
};

function missing(label, domain) {
  return { facts: [], sources: [makeSource({ module: label })], warnings: [`${label} data is not available.`], missing: true, domain };
}

/*
 * Gather evidence for a set of domains, respecting the session's scope.
 * Returns { facts, factValues, sources, warnings, flags } — the deterministic
 * evidence pack the orchestrator hands to the model and the confidence engine.
 */
export async function gatherEvidence(domains, scope) {
  if (!scope?.unrestricted) {
    // No finance data-scope grant → withhold financial detail entirely (CR §9).
    return {
      facts: [], factValues: [], sources: [],
      warnings: [scope?.note || "This account has no finance data-scope grant."],
      flags: {}, missing: true,
    };
  }

  const facts = [];
  const sources = [];
  const warnings = [];
  let flags = {};
  const missingLabels = [];

  const seen = new Set();
  for (const domain of domains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    const fetch = DOMAIN_FETCHERS[domain];
    if (!fetch) continue;
    try {
      const r = await fetch(scope);
      if (r.facts) facts.push(...r.facts);
      if (r.sources) {
        // Mark a source missing so the confidence engine can see it.
        for (const s of r.sources) sources.push({ ...s, missing: !!r.missing });
      }
      if (r.warnings) warnings.push(...r.warnings);
      if (r.flags) flags = { ...flags, ...r.flags };
      if (r.missing) missingLabels.push(domain);
    } catch (e) {
      warnings.push(`Could not retrieve ${domain}: ${e.message}`);
      sources.push({ ...makeSource({ module: domain }), missing: true });
      missingLabels.push(domain);
    }
  }

  return {
    facts,
    factValues: facts.map((f) => f.value).filter((v) => v != null),
    sources,
    warnings,
    flags,
    missing: missingLabels.length > 0,
  };
}

export const AVAILABLE_DOMAINS = Object.keys(DOMAIN_FETCHERS);
