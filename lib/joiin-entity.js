import { query } from "./db";
import { renderFormat, buildGenericFormat, classifyEntity } from "./pl-format.js";
import { getFormatSpec } from "./pl-format-store.js";

/*
 * Joiin per-entity standalone P&L — DB read + board-pack rendering (Phase 18).
 * Reads finance.joiin_pl_entity and renders the selected entity (or the
 * company-store consolidation) into its board-pack format. Store entities use
 * the Store format, the franchise entity the Franchise format, everything else
 * a generic detailed layout. Group naming follows house style (Miniso UK).
 */

const tableMissing = (e) => e?.code === "42P01";
const STORES_KEY = "__stores__";

// Legal entity name → Miniso UK trading label for display.
export function entityDisplayName(name) {
  const special = {
    "Kouriten Limited": "Head Office",
    "Kouriten Franchise Limited": "Franchise",
    "Kouriten Ltd E-COM": "E-Commerce",
    "Kouriten Holdings Limited": "Holdings",
    "Kouriten Stores Limited": "Stores (holding)",
    "New Kouriten Stores": "New Stores",
    "Kouriten Group Cashflow": "Group Cashflow",
    "Kouriten Outlet Limited": "Outlet",
    "Kouriten Castle Ltd": "Castle",
    "Kouriten Caledonia Limited": "Caledonia",
  };
  if (special[name]) return special[name];
  return name.replace(/^Kouriten\s+/, "").replace(/\s+(Limited|Ltd)$/, "");
}

export async function getEntityPnl(selected) {
  let rows;
  try {
    ({ rows } = await query(`SELECT entity_id, entity_name, section, account, ym, value FROM finance.joiin_pl_entity`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };

  const months = [...new Set(rows.map((r) => r.ym))].sort();

  // entity catalogue with classification
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.entity_id)) byId.set(r.entity_id, { key: r.entity_id, name: r.entity_name, accounts: new Set() });
    byId.get(r.entity_id).accounts.add(r.account);
  }
  const entities = [...byId.values()].map((e) => ({ key: e.key, name: e.name, display: entityDisplayName(e.name), kind: classifyEntity(e.name, [...e.accounts]) }));
  const storeIds = new Set(entities.filter((e) => e.kind === "store").map((e) => e.key));

  const order = { store: 0, franchise: 1, generic: 2 };
  const sortedEntities = entities.slice().sort((a, b) => (order[a.kind] - order[b.kind]) || a.display.localeCompare(b.display));
  const catalogue = [
    { key: STORES_KEY, name: "Company Stores (consolidated)", display: "Company Stores — consolidated", kind: "store" },
    ...sortedEntities,
  ];

  const sel = selected && catalogue.some((c) => c.key === selected) ? selected : STORES_KEY;

  // subset rows for the selection
  let subset, kind, label;
  if (sel === STORES_KEY) {
    subset = rows.filter((r) => storeIds.has(r.entity_id));
    kind = "store";
    label = "Company Stores — consolidated";
  } else {
    subset = rows.filter((r) => r.entity_id === sel);
    const ent = entities.find((e) => e.key === sel);
    kind = ent.kind;
    label = ent.display;
  }

  const av = {};
  for (const r of subset) (av[r.account] ||= {})[r.ym] = (av[r.account]?.[r.ym] || 0) + Number(r.value);

  let fmt = null;
  if (kind === "store" || kind === "franchise") fmt = await getFormatSpec(kind);
  if (!fmt) {
    const present = [...new Set(subset.map((r) => `${r.section}||${r.account}`))].map((s) => { const [section, account] = s.split("||"); return { section, account }; });
    fmt = buildGenericFormat(present);
  }
  const rendered = renderFormat(fmt, av, months);

  return { ready: true, loaded: true, months, catalogue, selected: sel, label, kind, rows: rendered };
}
