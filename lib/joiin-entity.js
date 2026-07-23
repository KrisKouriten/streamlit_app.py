import * as XLSX from "xlsx";
import { query } from "./db";
import { renderFormat, buildGenericFormat, classifyEntity } from "./pl-format.js";
import { getFormatSpec } from "./pl-format-store.js";
import { headerToYm, parseMoney } from "./joiin-rules.js";
import { ENTITY_ID } from "./entity-map.js";
import { getEntityMap } from "./joiin-entity-map.js";
export { ENTITY_ID };

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

// Scope-oriented P&L for the four-tab Management Accounts workbook. Renders the
// governed board-pack format for a scope (store / head_office / franchise /
// consolidated) against Joiin actuals, filtered to one year. The store scope
// also returns the store list so the UI can scroll each entity or the
// consolidation. Falls back to a generic detailed layout if the scope's format
// hasn't been uploaded yet (so every tab shows real actuals immediately).
const ALL_STORES = "__all_stores__";
export async function getScopePnl({ scope = "store", entity = null, year = null } = {}) {
  let rows;
  try {
    ({ rows } = await query(`SELECT entity_id, entity_name, section, account, ym, value FROM finance.joiin_pl_entity`));
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false };
    throw e;
  }
  if (!rows.length) return { ready: true, loaded: false };

  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.entity_id)) byId.set(r.entity_id, { key: r.entity_id, name: r.entity_name, accounts: new Set() });
    byId.get(r.entity_id).accounts.add(r.account);
  }
  const entities = [...byId.values()].map((e) => ({ key: e.key, name: e.name, display: entityDisplayName(e.name), kind: classifyEntity(e.name, [...e.accounts]) }));

  let setIds, label, storeList = null, sel = null;
  if (scope === "store") {
    const stores = entities.filter((e) => e.kind === "store").sort((a, b) => a.display.localeCompare(b.display));
    storeList = [{ key: ALL_STORES, display: "All stores — consolidated" }, ...stores.map((e) => ({ key: e.key, display: e.display }))];
    if (entity && entity !== ALL_STORES && stores.some((s) => s.key === entity)) { setIds = [entity]; sel = entity; label = stores.find((s) => s.key === entity).display; }
    else { setIds = stores.map((e) => e.key); sel = ALL_STORES; label = "All stores — consolidated"; }
  } else if (scope === "head_office") {
    const ho = entities.find((e) => e.name === "Kouriten Limited");
    setIds = ho ? [ho.key] : []; label = "Head Office";
  } else if (scope === "franchise") {
    setIds = entities.filter((e) => /franchise/i.test(e.name)).map((e) => e.key); label = "Franchise";
  } else {
    setIds = entities.map((e) => e.key); label = "Consolidated group"; // all nominals, all entities
  }

  const idSet = new Set(setIds);
  const scoped = rows.filter((r) => idSet.has(r.entity_id));
  const allMonths = [...new Set(scoped.map((r) => r.ym))].sort();
  const years = [...new Set(allMonths.map((m) => m.slice(0, 4)))].sort();
  const yr = year && years.includes(year) ? year : years[years.length - 1];
  const months = allMonths.filter((m) => m.startsWith(yr));

  const av = {};
  for (const r of scoped) (av[r.account] ||= {})[r.ym] = (av[r.account]?.[r.ym] || 0) + Number(r.value);

  let fmt = await getFormatSpec(scope);
  let usingGeneric = false;
  if (!fmt) {
    const present = [...new Set(scoped.map((r) => `${r.section}||${r.account}`))].map((s) => { const [section, account] = s.split("||"); return { section, account }; });
    fmt = buildGenericFormat(present);
    usingGeneric = true;
  }
  const rendered = renderFormat(fmt, av, months);

  return { ready: true, loaded: true, scope, years, year: yr, months, storeList, selected: sel, label, usingGeneric, rows: rendered };
}

// Ingest a Joiin "by-company" P&L export workbook. Each sheet is one month
// (sheet name carries the month, e.g. "2026-06" or "Jun 26"); entities are the
// columns; accounts are the rows, grouped under section headers. Un-eliminated
// standalone values. Upserts finance.joiin_pl_entity for the months uploaded.
export async function ingestByCompanyWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const entityMap = await getEntityMap();
  const canonName = {};
  for (const k of Object.keys(entityMap)) canonName[k.toLowerCase()] = k;
  const SECTIONS = { "revenue": "Revenue", "cost of sales": "Cost of Sales", "expenses": "Expenses", "other income": "Other Income", "other expenses": "Other Expenses" };

  const all = new Map(); // `${entity}||${section}||${account}||${ym}` -> value
  const monthsSeen = new Set();

  for (const sheetName of wb.SheetNames) {
    const ym = /^\d{4}-\d{2}$/.test(sheetName.trim()) ? sheetName.trim() : headerToYm(sheetName.trim());
    if (!ym) continue; // sheet not month-named — skip
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
    // header row: the one with the most cells matching known entity names
    let headerIdx = -1, colEntity = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hits = {};
      rows[i].forEach((c, k) => { const n = canonName[String(c).trim().toLowerCase()]; if (n) hits[k] = n; });
      if (Object.keys(hits).length >= 3) { headerIdx = i; colEntity = hits; break; }
    }
    if (headerIdx < 0) continue;
    monthsSeen.add(ym);
    let section = "P&L";
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const label = String(r[0] ?? "").trim();
      if (!label) continue;
      const low = label.toLowerCase();
      if (SECTIONS[low]) { section = SECTIONS[low]; continue; }
      if (low === "total" || low === "gross profit" || low === "operating profit" || low === "net profit" || low === "other profit") continue;
      // account row: read each entity column
      let any = false;
      for (const [k, ent] of Object.entries(colEntity)) {
        const v = parseMoney(r[k]);
        if (v == null) continue;
        any = true;
        const key = `${ent}||${section}||${label}||${ym}`;
        all.set(key, (all.get(key) || 0) + v);
      }
      void any;
    }
  }

  if (!monthsSeen.size) throw new Error("No month-named sheets found. Name each sheet for its month, e.g. 2026-06 or Jun 26.");

  const months = [...monthsSeen].sort();
  await query(`DELETE FROM finance.joiin_pl_entity WHERE ym = ANY($1)`, [months]);
  let n = 0;
  for (const [key, value] of all) {
    if (value === 0) continue;
    const [entity_name, section, account, ym] = key.split("||");
    const entity_id = entityMap[entity_name] || entity_name;
    await query(
      `INSERT INTO finance.joiin_pl_entity (entity_id, entity_name, section, account, ym, value, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (entity_id, section, account, ym) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
      [entity_id, entity_name, section, account, ym, value, actor || "upload"]
    );
    n++;
  }
  return { months, rows: n, entities: [...new Set([...all.keys()].map((k) => k.split("||")[0]))].length };
}
