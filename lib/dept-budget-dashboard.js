import { listBudgets, getBudget } from "./dept-budget";
import { listDepartments } from "./governance";
import { listPos } from "./purchase-orders";
import { budgetSummary, categoryGroups, monthlyTotals } from "./dept-budget-rules.js";
import { committedAmount } from "./po-rules.js";
import { cardSpendTotalForBudget } from "./card-spend";
import { procurementRollup } from "./procurement-close";
import { getProcurement } from "./procurement";
import { consolidateSummary } from "./procurement-rules.js";
import { supplierExposure, facilityPosition } from "./suppliers";

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
//
// The department's BUSINESS budget is the one the dashboard reports. A Project
// or Travel, Expenses & Entertainment budget for the same year is a separate
// budget, and must not stand in for it just because it was edited last.
function pickBudget(allBudgets) {
  if (!allBudgets.length) return null;
  const business = allBudgets.filter((b) => (b.budget_type || "BUSINESS") === "BUSINESS");
  const budgets = business.length ? business : allBudgets;
  const locked = budgets.filter((b) => b.status === "LOCKED");
  const pool = locked.length ? locked : budgets;
  return [...pool].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
}

/*
 * A department's P.O position for the year: open (live, not yet closed by
 * Finance) and committed (finance-CLOSED this year, invoice net where entered).
 * Shared by the dashboard and the hub's overspend check so the two agree.
 */
function poPosition(allPos = [], year) {
  const inYear = (p) => p.po_date && new Date(p.po_date).getFullYear() === Number(year);
  const openPos = allPos.filter((p) => LIVE_PO.has(p.status) && p.finance_status !== "CLOSED");
  const openValue = round2(openPos.reduce((t, p) => t + (Number(p.payment_value) || 0), 0));
  const closed = allPos.filter((p) => p.finance_status === "CLOSED" && inYear(p));
  const ytdCommitted = round2(closed.reduce((t, p) => t + committedAmount(p), 0));
  return { openPos, openValue, closed, ytdCommitted };
}

/*
 * Every department's budget position for the year, on the dashboard's own
 * basis: Budget remaining = proposed − committed (closed P.Os + card spend) −
 * open P.Os. Departments with no budget for the year are left out. For the
 * Executive Intelligence Hub's overspend check.
 */
export async function departmentBudgetPositions(year = new Date().getFullYear()) {
  const [budgetList, posRes] = await Promise.all([
    listBudgets({ year }).catch(() => ({ budgets: [] })),
    listPos({ limit: 10000 }).catch(() => ({ pos: [] })),
  ]);
  const byDept = new Map();
  for (const b of budgetList.budgets || []) {
    if (!b.department) continue;
    (byDept.get(b.department) || byDept.set(b.department, []).get(b.department)).push(b);
  }
  const out = [];
  for (const [department, budgets] of byDept) {
    const chosen = pickBudget(budgets);
    if (!chosen) continue;
    const full = await getBudget(chosen.budget_id).catch(() => null);
    if (!full) continue;
    const proposed = budgetSummary(full.budget.target_amount, full.lines).proposed || 0;
    const pos = poPosition((posRes.pos || []).filter((p) => p.department === department), year);
    const card = await cardSpendTotalForBudget(chosen.budget_id).catch(() => ({ total: 0 }));
    const committed = round2(pos.ytdCommitted + (Number(card.total) || 0));
    out.push({
      department, budgetId: chosen.budget_id,
      proposed, committed, open: pos.openValue,
      left: round2(proposed - committed - pos.openValue),
    });
  }
  return out;
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
  const { openPos, openValue, closed, ytdCommitted } = poPosition(allPos, year);

  // Card / pre-approved spend logged against this budget (migration 112) also
  // reports as committed spend — no P.O, no sign-off. Tied to the chosen budget so
  // it lands in the same year. Zero (never throws) before the migration.
  const cardSpend = chosen ? await cardSpendTotalForBudget(chosen.budget_id).catch(() => ({ total: 0, count: 0 })) : { total: 0, count: 0 };

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

  /*
   * The cash budget vs committed summaries, the same ones Procurement Requests
   * shows — asked for here so the Merchandising budget holder can read the
   * month's position without moving between two screens.
   *
   * Same call the Procurement Requests page makes, so the two screens cannot
   * report different figures: one source of arithmetic, shown twice. What is
   * added here is the consolidated view — Miniso and Local together, which is
   * every merch request too, since a request is stored under the source its
   * channel belongs to.
   */
  let procCash = null;
  if (department === "Merchandising") {
    const pr = await getProcurement().catch(() => null);
    if (pr && pr.summary) {
      procCash = {
        loaded: !!pr.loaded,
        illustrative: !!pr.illustrative,
        bySource: pr.summary,
        consolidated: consolidateSummary(pr.summary),
      };
    }
  }

  // ---- Supplier credit & HSBC facility (Merchandising only) ----
  // Supplier exposure vs credit limits + the HSBC facility headroom, from the
  // governed suppliers/credit layer (migration 090). null when it can't be read
  // (e.g. migration not applied) so the dashboard never breaks.
  let supplierCredit = null;
  if (department === "Merchandising") {
    supplierCredit = await Promise.all([
      supplierExposure().catch(() => null),
      facilityPosition("HSBC").catch(() => null),
    ]).then(([exposure, facility]) => ((exposure && exposure.ready) || facility ? { exposure, facility } : null))
      .catch(() => null);
  }

  return {
    ready: true,
    hasBudget: !!budget,
    hasPos: posRes.ready !== false,
    department, year,
    budget, summary, categories, monthly, proc, procCash, supplierCredit,
    cardSpend,
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
