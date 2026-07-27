/*
 * Business Projects (Plan — HO) — pure validation + summary. A register of
 * cross-functional business change projects. No external feed; entered in-app.
 */
export const STATUSES = ["Planned", "Active", "On hold", "Done"];
export const RAGS = ["green", "amber", "red"];

export function validateProject(i = {}) {
  const errors = [];
  const name = String(i.name || "").trim();
  if (!name) errors.push("Project name is required");
  const status = STATUSES.includes(i.status) ? i.status : "Planned";
  const rag = RAGS.includes(i.rag) ? i.rag : "green";
  const target_ym = /^\d{4}-\d{2}$/.test(String(i.target_ym || "")) ? String(i.target_ym) : null;
  const b = i.budget == null || i.budget === "" ? null : Number(String(i.budget).replace(/[£,\s]/g, ""));
  const budget = Number.isFinite(b) ? b : null;
  const id = i.id ? Number(i.id) : null;
  return {
    errors,
    clean: { id: Number.isFinite(id) ? id : null, name, category: String(i.category || "").trim() || null, owner: String(i.owner || "").trim() || null, status, rag, target_ym, budget, notes: String(i.notes || "").trim() || null },
  };
}

export function summarise(projects = []) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const rag = { green: 0, amber: 0, red: 0 };
  let budget = 0;
  for (const p of projects) {
    if (p.status in byStatus) byStatus[p.status]++;
    if (p.rag in rag) rag[p.rag]++;
    if (p.status !== "Done") budget += Number(p.budget) || 0;
  }
  return { total: projects.length, byStatus, rag, budget, active: byStatus["Active"] || 0, atRisk: rag.red };
}

// Committed budget counts open projects only (Done projects are delivered, so
// their budget is no longer a forward commitment). Shared by the groupers below
// and the summary, so "committed" means the same thing everywhere.
const isOpen = (p) => p.status !== "Done";

// Budget commitment + count by project category, richest commitment first.
export function groupByCategory(projects = []) {
  const m = new Map();
  for (const p of projects) {
    const key = p.category || "Uncategorised";
    const g = m.get(key) || { category: key, count: 0, budget: 0 };
    g.count++;
    if (isOpen(p)) g.budget += Number(p.budget) || 0;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.budget - a.budget || b.count - a.count);
}

// Delivery timeline: budget + count by target month (only projects with a
// target month), earliest first.
export function groupByMonth(projects = []) {
  const m = new Map();
  for (const p of projects) {
    if (!p.target_ym) continue;
    const g = m.get(p.target_ym) || { ym: p.target_ym, count: 0, budget: 0 };
    g.count++;
    if (isOpen(p)) g.budget += Number(p.budget) || 0;
    m.set(p.target_ym, g);
  }
  return [...m.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}
