import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listBudgets, getUserDepartment, listObjectives } from "../../../lib/dept-budget";
import { listDepartments } from "../../../lib/governance";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import DeptBudgetUI from "./dept-budget-ui";

export const dynamic = "force-dynamic";

// Departmental Budgets (Plan – HO) — a department head builds a budget for their
// department: cost lines phased across the 12 months of the year, versioned and
// signed off by the department's approvers (GOVERN → Users, Roles & Permissions).
export default async function DeptBudgetsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [list, departments, myDept, objectives] = await Promise.all([
    listBudgets({}),
    listDepartments(),
    getUserDepartment(session.id),
    listObjectives(),
  ]);

  const isAdminFinance = hasRole(session, "ADMIN", "FINANCE");
  const deptNames = departments.map((d) => d.department_name);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — HO" title="Departmental Budgets"
        right="Build, phase and sign off a department's budget for the year" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Departmental Budgets needs migration <span style={{ fontFamily: "var(--mono)" }}>049_dept_budget.sql</span> (idempotent). Run it, refresh, then create your first budget.
        </EmptyState>
      ) : (
        <DeptBudgetUI
          initialBudgets={list.budgets}
          departments={deptNames}
          myDept={myDept}
          isAdminFinance={isAdminFinance}
          me={session.email || session.name}
          initialObjectives={objectives}
        />
      )}
    </div>
  );
}
