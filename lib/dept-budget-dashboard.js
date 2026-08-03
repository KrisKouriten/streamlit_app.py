import { listBudgets, getBudget } from "./dept-budget";
import { listDepartments } from "./governance";
import { listPos } from "./purchase-orders";
import { budgetSummary, categoryGroups, monthlyTotals } from "./dept-budget-rules.js";
import { committedAmount } from "./po-rules.js";
import { procurementRollup } from "./procurement-close";

/*
 * Departmental Budget Dashboard — read-only roll-up for one department: its budget
 * for the year, the department's open purchase orders, and YTD committed spend.
 * Composes existing governed services (dept budgets + purchase orders); no new
 * store and no trading logic of its own. Every figure agrees with its source
 * module. Honest about limits: "spend" here is PO-committed spend (approved POs),
 * not GL actuals — there is no per-department GL actual feed yet.
 */

// Request statuses that are still "live" (not cancelled/rejected). A CLOSED
// finance_status is treated as done and drops out of the open list.
const LIVE_PO = new Set(["DRAFT", "PENDING_SIGNOFF", "APPROVED"]);
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
  const inYear = (p) => p.po_date && new Date(p.po_date).getFullYear() === Number(year);
  // Open = live request, not yet closed by finance.
  const openPos = allPos.filter((p) => LIVE_PO.has(p.status) && p.finance_status !== "CLOSED");
  const openValue = round2(openPos.reduce((t, p) => t + (Number(p.payment_value) || 0), 0));

  // Committed = finance-CLOSED P.Os this year (invoice net where entered).
  const closed = allPos.filter((p) => p.finance_status === "CLOSED" && inYear(p));
  const ytdCommitted = round2(closed.reduce((t, p) => t + committedAmount(p), 0));

  // Under challenge — highlighted on the dashboard and the requests screen.
  const challenged = allPos.filter((p) => p.finance_status === "CHALLENGED");
  const challengedValue = round2(challenged.reduce((t, p) => t + committedAmount(p), 0));

  // The P.O register — every P.O once it has been signed off (APPROVED), newest
  // first, with its finance status. Awaiting = still needs department-head
  // sign-off (the budget-holder's action queue).
  const register = allPos.filter((p) => p.status === "APPROVED")
    .sort((a, b) => new Date(b.approved_at || b.created_at) - new Date(a.approved_at || a.created_at));
  const awaiting = allPos.filter((p) => p.status === "PENDING_SIGNOFF")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // ---- Procurement (Merchandising only) ----
  // Merchandising's spend also flows through the Procurement Summary + Close
  // lifecycle (Miniso/Local purchases + OTB merch requests), so the dashboard
  // rolls that up alongside POs — the same visibility Marketing has for its POs.
  const proc = department === "Merchandising" ? await procurementRollup().catch(() => ({ ready: false })) : null;

  return {
    ready: true,
    hasBudget: !!budget,
    hasPos: posRes.ready !== false,
    department, year,
    budget, summary, categories, monthly, proc,
    pos: {
      open: openPos.slice(0, 50),
      openCount: openPos.length,
      openValue,
      ytdCommitted,
      closedCount: closed.length,
      pending: awaiting.length,
      challenged: challenged.slice(0, 20),
      challengedCount: challenged.length,
      challengedValue,
      register: register.slice(0, 200),
      registerCount: register.length,
      awaiting,
      awaitingCount: awaiting.length,
    },
  };
}
