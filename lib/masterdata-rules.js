/*
 * Master data — pure rules. No imports, no DB. The catalogue of governed
 * dimensions (what a "master data" home covers) and the pure status derivation
 * the hub renders. The DB layer (masterdata.js) supplies counts + last-changed
 * timestamps; this decides how each dimension reads. Unit-tested.
 */

// The governed dimensions everything joins to. `screen` is the admin route when
// one exists (the dimension is actively mastered in-app); null means the data
// may be live but there is no edit screen yet. `objectType` matches the audit
// event objectType so lineage can be looked up.
export const DIMENSIONS = [
  { key: "entities", label: "Entities", table: "core.dim_entity", objectType: "dim_entity", screen: "/govern/entities" },
  { key: "kpis", label: "KPI Definitions", table: "intelligence.dim_kpi", objectType: "dim_kpi", screen: "/govern/kpi-definitions" },
  { key: "stores", label: "Stores", table: "core.dim_store", objectType: "dim_store", screen: null },
  { key: "accounts", label: "Chart of Accounts", table: "core.dim_account", objectType: "dim_account", screen: null },
  { key: "scenarios", label: "Scenarios", table: "core.dim_scenario", objectType: "dim_scenario", screen: null },
  { key: "departments", label: "Departments", table: "core.dim_department", objectType: "dim_department", screen: null },
  { key: "products", label: "Products / SKUs", table: "core.dim_product", objectType: "dim_product", screen: null },
];

// How a dimension reads on the hub, from its row count and whether it has an
// admin screen:
//   MANAGED       — has data and an in-app admin screen (fully governed here)
//   LIVE          — has data but no edit screen yet (read-only, screen pending)
//   AWAITING FEED — no rows loaded yet (needs a data source before it's real)
export function statusFor({ count = 0, screen = null }) {
  if (!count) return { label: "AWAITING FEED", tone: "faint" };
  if (screen) return { label: "MANAGED", tone: "green" };
  return { label: "LIVE", tone: "accent" };
}

// Overall roll-up for the hub header.
export function summarise(rows) {
  return {
    total: rows.length,
    managed: rows.filter((r) => r.status?.label === "MANAGED").length,
    live: rows.filter((r) => r.status?.label === "LIVE").length,
    awaiting: rows.filter((r) => r.status?.label === "AWAITING FEED").length,
  };
}
