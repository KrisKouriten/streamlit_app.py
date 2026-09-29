import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { uploadExpenses, setDeptMapping, getExpenseReport, createExpenseTables } from "../../../lib/expenses";
import { departmentsHeadedBy } from "../../../lib/dept-budget";
import { expenseTabs, canSeeExpenses, CONSOLIDATED } from "../../../lib/expense-rules.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: the report for ?year= (and optionally ?department=).
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const u = new URL(request.url);
  const department = u.searchParams.get("department") || null;
  // Finance see everything; a head of department only their own department.
  const isFinance = hasRole(session, "ADMIN", "FINANCE");
  const access = expenseTabs({ isFinance, headed: isFinance ? [] : await departmentsHeadedBy(session.email).catch(() => []) });
  if (!isFinance && !canSeeExpenses(department || CONSOLIDATED, access)) {
    return NextResponse.json({ error: "Expense claims are visible to Finance and to the head of the department" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getExpenseReport({
      year: Number(u.searchParams.get("year")) || new Date().getFullYear(),
      department, claimant: u.searchParams.get("claimant") || null,
    }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// POST: upload the export, or map an export department onto an app department.
// Finance / admin only.
export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) return NextResponse.json({ error: "Expense claims are loaded by Finance" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "upload") {
      if (!body.text) return NextResponse.json({ error: "No file content" }, { status: 400 });
      return NextResponse.json(await uploadExpenses(String(body.text), { filename: body.filename || "" }, session));
    }
    if (body.action === "setup") return NextResponse.json(await createExpenseTables(session));
    if (body.action === "map") return NextResponse.json(await setDeptMapping(body.fileDept, body.appDept || null, session));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("expenses API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
