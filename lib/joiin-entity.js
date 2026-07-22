import * as XLSX from "xlsx";
import { query } from "./db";
import { renderFormat, buildGenericFormat, classifyEntity } from "./pl-format.js";
import { getFormatSpec } from "./pl-format-store.js";
import { headerToYm, parseMoney } from "./joiin-rules.js";

// Legal entity name → Joiin company id (the 26 group companies).
export const ENTITY_ID = {
  "Kouriten West London Limited": "86d2eaa0-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Stores Limited": "78b0e460-720f-11f0-9643-cd6865c61629",
  "Kouriten Shaftesbury Limited": "ec0d39e0-66a9-11ee-a3ff-f9ffd1c421bf",
  "Kouriten Oxford Street Ltd": "4d640f90-9821-11ee-a71c-a3b704e0f3e5",
  "Kouriten Oxford Limited": "87c5fd30-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Outlet Limited": "5fc4a990-b0c3-11ef-b508-fde00db1d925",
  "Kouriten Nottingham Limited": "886c0130-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Meadowhall Limited": "e31ac500-bfdf-11f0-9386-9f5651cf283d",
  "Kouriten Luton Limited": "254142c0-e236-11ef-8cd9-4724f1e97c63",
  "Kouriten Leeds Limited": "87ef0900-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Kingston Limited": "24fc7190-e236-11ef-8cd9-4724f1e97c63",
  "Kouriten Eastbourne Limited": "5fed4030-b0c3-11ef-b508-fde00db1d925",
  "Kouriten Ealing Limited": "857a8690-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Castle Ltd": "600c12d0-b0c3-11ef-b508-fde00db1d925",
  "Kouriten Cardiff Limited": "878f35c0-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Camden Ltd": "6bd75010-d0cd-11ee-a002-abfc6416826b",
  "Kouriten Cambridge Limited": "876566a0-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Caledonia Limited": "81380050-269c-11f0-a696-4143a9f0fc38",
  "Kouriten Brighton Limited": "873025d0-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Brent Cross Limited": "86098020-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Ltd E-COM": "6bb08e30-d0cd-11ee-a002-abfc6416826b",
  "Kouriten Franchise Limited": "8532cf30-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Limited": "87078f30-5c51-11ee-bab0-9b6377819a7b",
  "Kouriten Holdings Limited": "ae656140-e52e-11ee-b816-b3be153c8006",
  "New Kouriten Stores": "251ddc40-e236-11ef-8cd9-4724f1e97c63",
  "Kouriten Group Cashflow": "4e0eb190-946c-11f0-8417-8961218bd229",
};

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

// Ingest a Joiin "by-company" P&L export workbook. Each sheet is one month
// (sheet name carries the month, e.g. "2026-06" or "Jun 26"); entities are the
// columns; accounts are the rows, grouped under section headers. Un-eliminated
// standalone values. Upserts finance.joiin_pl_entity for the months uploaded.
export async function ingestByCompanyWorkbook(buffer, actor) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const canonName = {};
  for (const k of Object.keys(ENTITY_ID)) canonName[k.toLowerCase()] = k;
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
    const entity_id = ENTITY_ID[entity_name] || entity_name;
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
