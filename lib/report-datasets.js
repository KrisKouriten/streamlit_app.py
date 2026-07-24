import { getJoiinPnl } from "./joiin.js";
import { getBalanceSheet } from "./joiin-bs.js";
import { resolveAllTabs } from "./ma-boardpack-view.js";
import { pnlToTab, bsToTab } from "./report-rows.js";

/*
 * Report Builder — dataset adapter. Maps a dataset_key + params to the common
 * tab shape ([{ tab, label, data:{months, rows, year} }]) the renderer and the
 * export path consume. Adding a dataset is a single case here; the rows come
 * from the existing read layers + the pure transforms in report-rows.js.
 */

// The datasets a report can target, with the params each accepts (for the UI).
export const DATASETS = [
  { key: "consolidated-pnl", label: "Consolidated P&L", params: [{ key: "period", kind: "period" }] },
  { key: "balance-sheet", label: "Balance Sheet", params: [{ key: "month", kind: "month" }] },
  { key: "management-accounts", label: "Management Accounts (board pack)", params: [{ key: "year", kind: "year" }, { key: "period", kind: "period" }] },
];
export const DATASET_KEYS = new Set(DATASETS.map((d) => d.key));
export const datasetLabel = (k) => DATASETS.find((d) => d.key === k)?.label || k;

// Resolve a dataset to its tabs. Returns { ready, reason?, tabs }.
export async function buildReportTabs(datasetKey, params = {}) {
  if (datasetKey === "consolidated-pnl") {
    const pnl = await getJoiinPnl();
    if (!pnl.loaded) return { ready: false, reason: "No consolidated P&L is loaded yet.", tabs: [] };
    return { ready: true, tabs: [{ tab: "pnl", label: "Consolidated P&L", data: pnlToTab(pnl) }] };
  }
  if (datasetKey === "balance-sheet") {
    const bs = await getBalanceSheet(params.month || null);
    if (!bs.loaded) return { ready: false, reason: "No balance sheet is loaded yet (Joiin BS feed / migration 036).", tabs: [] };
    return { ready: true, tabs: [{ tab: "bs", label: `Balance Sheet — ${bs.asAt}`, data: bsToTab(bs) }] };
  }
  if (datasetKey === "management-accounts") {
    const tabs = await resolveAllTabs(params.year || null);
    return { ready: tabs.length > 0, reason: tabs.length ? null : "No board pack is loaded for this year.", tabs };
  }
  return { ready: false, reason: "Unknown dataset.", tabs: [] };
}
