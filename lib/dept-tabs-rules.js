/*
 * Department tabs — pure, unit-testable. Shared by the screens that split work
 * by department (Purchase Order Requests, P.O Summary + Close).
 *
 *   Finance (and admins) — an "All departments" tab plus one per department.
 *   Anyone else — a tab for each department that is theirs: their own
 *     department on their profile, the departments they sign off for, and any
 *     department they have raised a P.O under. Never "All".
 */
export const ALL_DEPTS = "__all__";

export function deptTabsFor({ seeAll = false, departments = [], mine = [] } = {}) {
  const clean = (l) => [...new Set((l || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  if (seeAll) return [ALL_DEPTS, ...clean(departments)];
  return clean(mine);
}

// The tab to open: the one asked for if allowed, else the first allowed.
export function pickDeptTab(requested, tabs = []) {
  if (!tabs.length) return null;
  return tabs.includes(requested) ? requested : tabs[0];
}

// Rows the viewer may see at all (server-side), and the rows for one tab.
export function rowsForViewer(rows = [], tabs = []) {
  if (tabs.includes(ALL_DEPTS)) return rows || [];
  const allowed = new Set(tabs);
  return (rows || []).filter((r) => allowed.has(r.department));
}
export function rowsForTab(rows = [], tab) {
  return tab === ALL_DEPTS ? rows || [] : (rows || []).filter((r) => r.department === tab);
}
