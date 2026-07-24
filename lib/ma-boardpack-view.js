import { getScopePnl } from "./joiin-entity";
import { getBoardPack } from "./joiin-boardpack";

/*
 * Management Accounts board-pack — tab resolution (server). Board-pack tabs
 * (and the store consolidation) render Joiin's own custom-report board pack —
 * Joiin does the arithmetic and the intercompany wholesale elimination, so we
 * render it verbatim. An individual store scrolls its per-entity standalone
 * P&L. When a scope's board pack isn't loaded we fall back to the per-entity
 * data so the tab still shows actuals. Shared by the MA page and the export.
 */

export const SCOPES = ["store", "head_office", "franchise", "consolidated"];
export const TAB_LABEL = { store: "Store", head_office: "Head Office", franchise: "Franchise", consolidated: "Consolidated" };
export const PERIODS = ["current", "trailing", "ytd"];
export const SCOPE_NOTE = {
  store: "Company-owned store actuals in the Store board-pack format. Toggle the year, or scroll each store or the consolidation.",
  head_office: "Head Office / wholesale actuals in the Head Office board-pack format. Toggle the year.",
  franchise: "Franchise actuals in the Franchise board-pack format. Toggle the year.",
  consolidated: "All group nominals consolidated, per the Consolidated format. Toggle the year.",
};

export async function resolveTab(tab, storeParam, year) {
  if (tab === "store") {
    const scoped = await getScopePnl({ scope: "store", entity: storeParam, year });
    if (!scoped.ready) return { ready: false };
    if (!scoped.loaded) return { ready: true, loaded: false };
    const isAll = scoped.storeList && scoped.selected === scoped.storeList[0].key;
    if (isAll) {
      const bp = await getBoardPack("store", year);
      if (bp.loaded) return { ready: true, loaded: true, source: "boardpack", years: bp.years, year: bp.year, months: bp.months, rows: bp.rows, label: "All stores — consolidated", storeList: scoped.storeList, selected: scoped.selected };
    }
    // individual store (or store board pack not loaded) — per-entity standalone
    return { ready: true, loaded: true, source: scoped.usingGeneric ? "generic" : "entity", years: scoped.years, year: scoped.year, months: scoped.months, rows: scoped.rows, label: scoped.label, storeList: scoped.storeList, selected: scoped.selected, usingGeneric: scoped.usingGeneric };
  }

  const bp = await getBoardPack(tab, year);
  if (bp.loaded) return { ready: true, loaded: true, source: "boardpack", years: bp.years, year: bp.year, months: bp.months, rows: bp.rows, label: TAB_LABEL[tab] };
  const scoped = await getScopePnl({ scope: tab, year });
  if (!scoped.ready) return { ready: false };
  if (!scoped.loaded) return { ready: true, loaded: false };
  return { ready: true, loaded: true, source: scoped.usingGeneric ? "generic" : "entity", years: scoped.years, year: scoped.year, months: scoped.months, rows: scoped.rows, label: scoped.label, usingGeneric: scoped.usingGeneric };
}

// Resolve all four board-pack scopes for a year (store → the consolidation, not
// an individual store). Returns only the tabs that have actuals loaded, in tab
// order, each tagged with its scope key and label — the shape the export walks.
export async function resolveAllTabs(year) {
  const out = [];
  for (const tab of SCOPES) {
    const data = await resolveTab(tab, null, year);
    if (data.loaded) out.push({ tab, label: data.label || TAB_LABEL[tab], data });
  }
  return out;
}
