import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../../lib/auth";
import { getUserDepartment, departmentsHeadedBy } from "../../../../../lib/dept-budget";
import { listDepartments } from "../../../../../lib/governance";
import { teeBudgetTemplate, uploadTeeBudgets } from "../../../../../lib/tee-budget";
import { teeUploadDepartments } from "../../../../../lib/tee-budget-rules.js";
import { toCsv } from "../../../../../lib/expense-rules.js";

export const dynamic = "force-dynamic";

/*
 * Travel, Expenses & Entertainment budgets on Departmental Budgets.
 *   GET  ?year=&department=&level=DEPARTMENT|EMPLOYEE   the template, as CSV
 *   POST { file (base64), filename }                     load a filled template
 * Finance and admins act for every department; anyone else only for the
 * departments they head or belong to (teeUploadDepartments).
 */
async function allowedFor(session) {
  const isFinance = hasRole(session, "ADMIN", "FINANCE");
  const [depts, headed, myDept] = await Promise.all([
    listDepartments().catch(() => []).then((r) => r.map((d) => d.department_name)),
    isFinance ? [] : departmentsHeadedBy(session.email).catch(() => []),
    isFinance ? null : getUserDepartment(session.id).catch(() => null),
  ]);
  return teeUploadDepartments({ isFinance, headed, myDept, departments: depts });
}

export async function GET(request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const level = sp.get("level") === "EMPLOYEE" ? "EMPLOYEE" : "DEPARTMENT";
  const allowed = await allowedFor(session);
  const want = sp.get("department");
  const departments = want && want !== "all" ? allowed.filter((d) => d === want) : allowed;
  if (!departments.length) return new Response("You can only download the T&E template for your own department", { status: 403 });
  const csv = toCsv(await teeBudgetTemplate(year, { departments, level }));
  const slug = departments.length === 1 ? `-${departments[0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="te-budget-${year}${slug}${level === "EMPLOYEE" ? "-per-employee" : ""}.csv"`,
    },
  });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body.file) return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
  const allowed = await allowedFor(session);
  if (!allowed.length) return NextResponse.json({ error: "You can only load T&E budgets for your own department" }, { status: 403 });
  try {
    return NextResponse.json(await uploadTeeBudgets(Buffer.from(String(body.file), "base64"), { filename: body.filename || "" , allowed }, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
