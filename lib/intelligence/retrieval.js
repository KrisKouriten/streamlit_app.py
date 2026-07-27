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
