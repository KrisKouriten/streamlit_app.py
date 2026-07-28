import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import {
  listBudgets, getBudget, createBudget, saveLines, setTarget,
  transitionBudget, deleteBudget,
  budgetDepartment, getUserDepartment, getApproverEmails,
} from "../../../../lib/dept-budget";
import { BUDGET_TRANSITIONS } from "../../../../lib/dept-budget-rules";

export const dynamic = "force-dynamic";

// May the user edit budgets for this department? ADMIN/FINANCE anywhere; a
// department member only within their own department.
async function canEditDept(session, department) {
  if (hasRole(session, "ADMIN", "FINANCE")) return true;
  const dept = await getUserDepartment(session.id);
  return !!dept && dept === department;
}

async function isApprover(session, department) {
  if (hasRole(session, "ADMIN")) return true;
  const emails = (await getApproverEmails(department)).map((e) => (e || "").toLowerCase());
  return emails.includes((session.email || "").toLowerCase());
}

/*
 * Whether the session may run a given workflow transition, per its role tag:
 *   OWNER         — the department's own head, or ADMIN/FINANCE (edit rights)
 *   FINANCE       — ADMIN/FINANCE
 *   DEPT_APPROVER — a listed department sign-off approver, or ADMIN
 *   ADMIN         — SLT / admin
 */
async function canTransition(session, department, action) {
  const role = BUDGET_TRANSITIONS[action]?.role;
  if (!role) return false;
  if (role === "ADMIN") return hasRole(session, "ADMIN");
  if (role === "FINANCE") return hasRole(session, "ADMIN", "FINANCE");
  if (role === "DEPT_APPROVER") return isApprover(session, department);
  if (role === "OWNER") return canEditDept(session, department);
  return false;
}

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const loaded = await getBudget(Number(id));
    if (!loaded) return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    const dept = loaded.budget.department;
    const [canEdit, canApprove, isAdmin, isFinance, approvers] = await Promise.all([
      canEditDept(session, dept), isApprover(session, dept),
      Promise.resolve(hasRole(session, "ADMIN")), Promise.resolve(hasRole(session, "ADMIN", "FINANCE")),
      getApproverEmails(dept),
    ]);
    // The transitions this user can actually run from the current stage.
    const allowed = {};
    for (const action of Object.keys(BUDGET_TRANSITIONS)) {
      allowed[action] = await canTransition(session, dept, action);
    }
    return NextResponse.json({ ...loaded, canEdit, canApprove, isAdmin, isFinance, approvers, allowed });
  }

  const department = url.searchParams.get("department") || null;
  const year = url.searchParams.get("year") ? Number(url.searchParams.get("year")) : null;
  const r = await listBudgets({ department, year });
  return NextResponse.json(r);
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  try {
    if (action === "create") {
      if (!(await canEditDept(session, body.department))) {
        return NextResponse.json({ error: "You can only create budgets for your own department" }, { status: 403 });
      }
      return NextResponse.json({ ok: true, ...(await createBudget(body, session)) });
    }

    const budgetId = Number(body.budgetId);
    if (!Number.isInteger(budgetId)) return NextResponse.json({ error: "Invalid budget" }, { status: 400 });
    const dept = await budgetDepartment(budgetId);
    if (!dept) return NextResponse.json({ error: "Budget not found" }, { status: 404 });

    if (action === "save-lines" || action === "delete") {
      if (!(await canEditDept(session, dept))) return NextResponse.json({ error: "You cannot edit this department's budget" }, { status: 403 });
      if (action === "save-lines") return NextResponse.json(await saveLines(budgetId, body.lines || [], session));
      return NextResponse.json(await deleteBudget(budgetId, session));
    }

    if (action === "set-target") {
      if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Only Finance or an admin can set the budget target" }, { status: 403 });
      return NextResponse.json(await setTarget(budgetId, body.target, session));
    }

    if (action === "transition") {
      const t = body.transition;
      if (!BUDGET_TRANSITIONS[t]) return NextResponse.json({ error: "Unknown transition" }, { status: 400 });
      if (!(await canTransition(session, dept, t))) {
        return NextResponse.json({ error: "You are not authorised to run that step" }, { status: 403 });
      }
      return NextResponse.json(await transitionBudget(budgetId, t, { note: body.note || null }, session));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
