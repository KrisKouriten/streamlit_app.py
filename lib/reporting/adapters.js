import { gatherEvidence } from "../intelligence/retrieval";
import { getFranchise, getInventoryHealth } from "../finance-os";
import { getActionSummary, listActions } from "../actions";
import { getWindows, getStoreLeague } from "../store-sales";

/*
 * Corporate Reporting Centre — source adapters (CR §30). One controlled way for
 * a report component to pull governed data from a Finance OS module, so report
 * templates never couple to a dashboard's implementation. Every adapter returns
 * the same envelope; figures come from the SAME governed services the dashboards
 * and the Intelligence Layer use, so a report reconciles to its source (CR §13).
 *
 * Envelope:
 *   { key, label, ready, reason, kpis:[{label,value,unit}], table:{columns,rows}|null,
 *     metadata:{ sourceRoute, dataThrough, provenance, approvalStatus, validationStatus, filters },
 *     warnings:[], flags:{} }
 *
 * A domain-backed adapter delegates to gatherEvidence (permission-aware, scope
 * checked). An unbuilt domain (treasury, wholesale, purchase orders) returns
 * ready:false with an honest "awaiting feed" reason — never invented figures.
 */

function envelope(key, label, route, extra = {}) {
  return {
    key,
    label,
    ready: false,
    reason: null,
    kpis: [],
    table: null,
    metadata: {
      sourceRoute: route || null,
      dataThrough: null,
      provenance: "feed",
      approvalStatus: "GOVERNED",
      validationStatus: "OK",
      filters: extra.filters || {},
    },
    warnings: [],
    flags: {},
  };
}

function firstDataThrough(sources = []) {
  for (const s of sources) if (s?.dataThrough) return s.dataThrough;
  return null;
}

// A domain-backed adapter: pull facts + sources from the governed retrieval
// layer for the given intelligence domains.
function domainAdapter(key, label, route, domains) {
  return async ({ scope, filters }) => {
    const env = envelope(key, label, route, { filters });
    const ev = await gatherEvidence(domains, scope);
    env.kpis = (ev.facts || []).map((f) => ({ label: f.label, value: f.value, unit: f.unit || "£" }));
    env.metadata.dataThrough = firstDataThrough(ev.sources);
    if (ev.sources?.length && ev.sources[0].route) env.metadata.sourceRoute = ev.sources[0].route;
    env.warnings = ev.warnings || [];
    env.flags = ev.flags || {};
    if (ev.missing && !env.kpis.length) {
      env.ready = false;
      env.reason = `Awaiting ${label} data.`;
      env.metadata.validationStatus = "MISSING";
    } else {
      env.ready = env.kpis.length > 0;
      if (!env.ready) env.reason = `Awaiting ${label} data.`;
    }
    if (ev.flags?.hasUnapprovedForecast) env.metadata.approvalStatus = "WORKING_FORECAST";
    return env;
  };
}

// An adapter that isn't connected to a data feed yet (CR: honesty over fabrication).
function awaitingAdapter(key, label, route, note) {
  return async ({ filters }) => {
    const env = envelope(key, label, route, { filters });
    env.ready = false;
    env.reason = note || `Awaiting ${label} feed — not connected yet.`;
    env.metadata.provenance = "awaiting";
    env.metadata.validationStatus = "MISSING";
    return env;
  };
}

export const SOURCE_ADAPTERS = {
  executive_hub: domainAdapter("executive_hub", "Executive Hub", "/finance-os/executive", ["finance_snapshot", "store_performance"]),
  store_sales: domainAdapter("store_sales", "Store Sales & KPI", "/finance-os/store-sales", ["store_performance"]),
  management_accounts: domainAdapter("management_accounts", "Management Accounts", "/finance-os/management-accounts", ["management_accounts", "finance_snapshot"]),
  cash: domainAdapter("cash", "Cash Flow", "/finance-os/cashflow", ["cash"]),
  forecast: domainAdapter("forecast", "Forecast", "/plan/scenarios", ["scenarios"]),
  sku: domainAdapter("sku", "SKU Analysis", "/finance-os/sku-analysis", ["sku"]),
  close: domainAdapter("close", "Month-End Close", "/operate/close", ["close_status"]),
  projects: domainAdapter("projects", "Business Projects", "/plan/business-projects", ["business_projects"]),

  // Store ranking — a KPI-light adapter with a real league table (top stores).
  store_ranking: async ({ scope, filters }) => {
    const env = envelope("store_ranking", "Store Ranking", "/finance-os/store-sales/league", { filters });
    if (!scope?.unrestricted) { env.reason = scope?.note || "Not cleared for a cross-store comparison."; return env; }
    try {
      const win = await getWindows();
      const rows = win ? await getStoreLeague(win.ytd || win) : [];
      if (!rows?.length) { env.reason = "Awaiting store sales data."; env.metadata.validationStatus = "MISSING"; return env; }
      const top = rows.slice(0, Number(filters?.limit) || 10);
      env.table = {
        columns: [
          { key: "store", label: "Store" },
          { key: "operator", label: "Operator" },
          { key: "net", label: "Net sales", align: "right", money: true },
          { key: "gm", label: "Gross margin", align: "right", money: true },
        ],
        rows: top.map((r) => ({ store: r.store_name || r.store_code, operator: r.operator_name || "—", net: Number(r.net) || 0, gm: Number(r.gm) || 0 })),
      };
      env.kpis = [
        { label: "Stores ranked", value: rows.length, unit: "count" },
        { label: "Top store net sales", value: Number(rows[0]?.net) || 0, unit: "£" },
      ];
      env.ready = true;
    } catch (e) {
      env.reason = `Store ranking unavailable: ${e.message}`;
      env.metadata.validationStatus = "MISSING";
    }
    return env;
  },

  // Inventory — KPIs from the governed service (illustrative until a real feed).
  inventory: async ({ scope, filters }) => {
    const env = envelope("inventory", "Inventory", "/finance-os/inventory", { filters });
    try {
      const h = await getInventoryHealth();
      if (!h) { env.reason = "Awaiting inventory feed."; env.metadata.validationStatus = "MISSING"; return env; }
      env.metadata.provenance = "illustrative";
      env.warnings = ["Inventory figures are an illustrative seed — not a real feed yet."];
      env.kpis = [];
      if (h.stockValue != null) env.kpis.push({ label: "Stock value", value: Number(h.stockValue), unit: "£" });
      if (h.coverWeeks != null) env.kpis.push({ label: "Cover (weeks)", value: Number(h.coverWeeks), unit: "count" });
      env.ready = env.kpis.length > 0;
      if (!env.ready) env.reason = "Awaiting inventory feed.";
    } catch (e) {
      env.reason = `Inventory unavailable: ${e.message}`;
    }
    return env;
  },

  // Franchise — real table + KPIs from commercial.fact_franchise.
  franchise: async ({ filters }) => {
    const env = envelope("franchise", "Franchise", "/finance-os/franchise", { filters });
    try {
      const rows = await getFranchise();
      if (!rows?.length) { env.reason = "Awaiting franchise feed."; env.metadata.validationStatus = "MISSING"; return env; }
      env.metadata.provenance = "illustrative";
      env.warnings = ["Franchise figures are an illustrative seed — not a real feed yet."];
      const invoiced = rows.reduce((s, r) => s + (Number(r.invoiced_sales) || 0), 0);
      const overdue = rows.reduce((s, r) => s + (Number(r.overdue_receivable) || 0), 0);
      env.kpis = [
        { label: "Franchise invoiced sales", value: invoiced, unit: "£" },
        { label: "Overdue receivables", value: overdue, unit: "£" },
        { label: "Franchise stores", value: rows.length, unit: "count" },
      ];
      env.table = {
        columns: [
          { key: "store", label: "Franchisee / store" },
          { key: "region", label: "Region" },
          { key: "invoiced", label: "Invoiced sales", align: "right", money: true },
          { key: "overdue", label: "Overdue", align: "right", money: true },
        ],
        rows: rows.slice(0, 10).map((r) => ({ store: r.store_name, region: r.region || "—", invoiced: Number(r.invoiced_sales) || 0, overdue: Number(r.overdue_receivable) || 0 })),
      };
      env.ready = true;
    } catch (e) {
      env.reason = `Franchise unavailable: ${e.message}`;
    }
    return env;
  },

  // Priority actions — the governed Action Centre (real table + summary KPIs).
  actions: async ({ filters }) => {
    const env = envelope("actions", "Action Centre", "/govern/actions", { filters });
    try {
      const [summary, rows] = await Promise.all([getActionSummary().catch(() => null), listActions({ status: null }).catch(() => [])]);
      if (summary) {
        env.kpis = [
          { label: "Open actions", value: Number(summary.open) || 0, unit: "count" },
          { label: "Overdue", value: Number(summary.overdue) || 0, unit: "count" },
          { label: "Expected value (open)", value: Number(summary.open_value) || 0, unit: "£" },
        ];
      }
      const open = (rows || []).filter((r) => r.status !== "CANCELLED").slice(0, 8);
      if (open.length) {
        env.table = {
          columns: [
            { key: "title", label: "Action" },
            { key: "owner", label: "Owner" },
            { key: "status", label: "Status" },
            { key: "due", label: "Due" },
            { key: "value", label: "Expected £", align: "right", money: true },
          ],
          rows: open.map((r) => ({
            title: r.action_title, owner: r.owner_name || "—", status: r.status,
            due: r.due_date ? new Date(r.due_date).toLocaleDateString("en-GB") : "—",
            value: Number(r.expected_value_gbp) || 0,
          })),
        };
      }
      env.ready = env.kpis.length > 0 || !!env.table;
      if (!env.ready) env.reason = "No actions recorded.";
    } catch (e) {
      env.reason = `Actions unavailable: ${e.message}`;
    }
    return env;
  },

  // Not connected yet — honest placeholders (CR: no invented figures).
  treasury: awaitingAdapter("treasury", "Treasury", "/finance-os/cashflow", "Awaiting a bank-facility / forward-cash feed — not connected yet."),
  wholesale: awaitingAdapter("wholesale", "Wholesale", null, "Awaiting a wholesale income feed — not connected yet."),
  purchase_orders: awaitingAdapter("purchase_orders", "Purchase Orders", "/operate/procurement", "Awaiting a purchase-order feed — not connected yet."),
};

export const SOURCE_KEYS = Object.keys(SOURCE_ADAPTERS);

export function hasAdapter(key) {
  return Object.prototype.hasOwnProperty.call(SOURCE_ADAPTERS, key);
}

// Resolve one source to its envelope. Never throws — an unknown/failed source
// degrades to a not-ready envelope so a report page can render "awaiting".
export async function resolveSource(sourceKey, { scope, filters = {} } = {}) {
  if (!sourceKey) return { ...envelope("none", "No source", null), ready: false, reason: "No data source selected." };
  const adapter = SOURCE_ADAPTERS[sourceKey];
  if (!adapter) return { ...envelope(sourceKey, sourceKey, null), ready: false, reason: `Unknown source '${sourceKey}'.` };
  try {
    return await adapter({ scope, filters });
  } catch (e) {
    const env = envelope(sourceKey, sourceKey, null, { filters });
    env.reason = `Source error: ${e.message}`;
    env.metadata.validationStatus = "MISSING";
    return env;
  }
}
