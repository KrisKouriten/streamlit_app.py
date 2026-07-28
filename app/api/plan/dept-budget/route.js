import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import {
  listBudgets, getBudget, createBudget, saveLines,
  submitBudget, approveBudget, reopenBudget, deleteBudget,
  budgetDepartment, getUserDepartment, getApproverEmails,
} from "../../../../lib/dept-budget";

export const dynamic = "force-dynamic";

// May the user edit budgets for this department? ADMIN/FINANCE anywhere; a
// department member only within their own department.
async function canEditDept(session, department) {
  if (hasRole(session, "ADMIN", "FINANCE")) return true;
  const dept = await getUserDepartment(session.id);
  return !!dept && dept === department;
}

// May the user sign off this department's budget? ADMIN, or a listed approver.
async function canApproveDept(session, department) {
  if (hasRole(session, "ADMIN")) return true;
  const emails = (await getApproverEmails(department)).map((e) => (e || "").toLowerCase());
  return emails.includes((session.email || "").toLowerCase());
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
    const [canEdit, canApprove, approvers] = await Promise.all([
      canEditDept(session, dept), canApproveDept(session, dept), getApproverEmails(dept),
    ]);
    return NextResponse.json({ ...loaded, canEdit, canApprove, approvers });
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
      const { department } = body;
      if (!(await canEditDept(session, department))) {
        return NextResponse.json({ error: "You can only create budgets for your own department" }, { status: 403 });
      }
      const r = await createBudget(body, session);
      return NextResponse.json({ ok: true, ...r });
    }

    // Everything below acts on an existing budget — resolve its department first.
    const budgetId = Number(body.budgetId);
    if (!Number.isInteger(budgetId)) return NextResponse.json({ error: "Invalid budget" }, { status: 400 });
    const dept = await budgetDepartment(budgetId);
    if (!dept) return NextResponse.json({ error: "Budget not found" }, { status: 404 });

    if (action === "save-lines" || action === "submit" || action === "reopen" || action === "delete") {
      if (!(await canEditDept(session, dept))) {
        return NextResponse.json({ error: "You cannot edit this department's budget" }, { status: 403 });
      }
      if (action === "save-lines") return NextResponse.json(await saveLines(budgetId, body.lines || [], session));
      if (action === "submit") return NextResponse.json(await submitBudget(budgetId, session));
      if (action === "reopen") return NextResponse.json(await reopenBudget(budgetId, session));
      if (action === "delete") return NextResponse.json(await deleteBudget(budgetId, session));
    }

    if (action === "approve") {
      if (!(await canApproveDept(session, dept))) {
        return NextResponse.json({ error: "Only this department's sign-off approvers (or an admin) can approve" }, { status: 403 });
      }
      return NextResponse.json(await approveBudget(budgetId, session));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
