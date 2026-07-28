import { listBudgets, getBudget } from "./dept-budget";
import { listDepartments } from "./governance";
import { listPos } from "./purchase-orders";
import { budgetSummary, categoryGroups, monthlyTotals } from "./dept-budget-rules.js";

/*
 * Departmental Budget Dashboard — read-only roll-up for one department: its budget
 * for the year, the department's open purchase orders, and YTD committed spend.
 * Composes existing governed services (dept budgets + purchase orders); no new
 * store and no trading logic of its own. Every figure agrees with its source
 * module. Honest about limits: "spend" here is PO-committed spend (approved POs),
 * not GL actuals — there is no per-department GL actual feed yet.
 */

const OPEN_PO = new Set(["DRAFT", "PENDING_SIGNOFF", "APPROVED"]);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The budget to show for a department/year: prefer the locked (approved) one, else
// the most recently updated.
function pickBudget(budgets) {
  if (!budgets.length) return null;
  const locked = budgets.filter((b) => b.status === "LOCKED");
  const pool = locked.length ? locked : budgets;
  return [...pool].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
}

export async function departmentList() {
  const rows = await listDepartments();
  return rows.map((d) => d.department_name);
}

export async function getDepartmentDashboard(department, year) {
  if (!department) return { ready: true, hasBudget: false, hasPos: false };

  const [budgetList, posRes] = await Promise.all([
    listBudgets({ department, year }).catch(() => ({ ready: false, budgets: [] })),
    listPos({ department, limit: 500 }).catch(() => ({ ready: false, pos: [] })),
  ]);

  // ---- Budget ----
  let budget = null, summary = null, categories = [], monthly = [];
  const chosen = pickBudget(budgetList.budgets || []);
  if (chosen) {
    const full = await getBudget(chosen.budget_id);
    if (full) {
      budget = full.budget;
      summary = budgetSummary(budget.target_amount, full.lines);
      categories = categoryGroups(full.lines).map((g) => ({ category: g.category, subtotal: g.subtotal }));
      monthly = monthlyTotals(full.lines);
    }
  }

  // ---- Purchase orders for the department ----
  const allPos = posRes.pos || [];
  const openPos = allPos.filter((p) => OPEN_PO.has(p.status));
  const openValue = round2(openPos.reduce((t, p) => t + (Number(p.payment_value) || 0), 0));
  const ytdCommitted = round2(
    allPos
      .filter((p) => p.status === "APPROVED" && p.po_date && new Date(p.po_date).getFullYear() === Number(year))
      .reduce((t, p) => t + (Number(p.payment_value) || 0), 0)
  );

  return {
    ready: true,
    hasBudget: !!budget,
    hasPos: posRes.ready !== false,
    department, year,
    budget, summary, categories, monthly,
    pos: {
      open: openPos.slice(0, 50),
      openCount: openPos.length,
      openValue,
      ytdCommitted,
      pending: openPos.filter((p) => p.status === "PENDING_SIGNOFF").length,
    },
  };
}
