import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { canExport } from "../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../lib/reporting/watermark";
import Restricted from "../../restricted";
import ScreenWatermark from "../../screen-watermark";
import { listBudgets, getUserDepartment, listObjectives, departmentsHeadedBy } from "../../../lib/dept-budget";
import { teeBudgetOverview } from "../../../lib/tee-budget";
import { teeUploadDepartments } from "../../../lib/tee-budget-rules.js";
import { listDepartments } from "../../../lib/governance";
import { getBusinessProjects } from "../../../lib/business-projects";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import DeptBudgetUI from "./dept-budget-ui";
import TeeBudgets from "./tee-ui";

export const dynamic = "force-dynamic";

// Departmental Budgets (Plan – HO) — a department head builds a budget for their
// department: cost lines phased across the 12 months of the year, versioned and
// signed off by the department's approvers (GOVERN → Users, Roles & Permissions).
//
// Two headers: BAU & Projects, and Travel, Expenses & Entertainment — the T&E
// budgets kept apart from the day-to-day ones and loaded by each department's
// head from a template, for the department or per employee.
const VIEWS = [["bau", "BAU & Projects"], ["tee", "Travel, Expenses & Entertainment"]];

export default async function DeptBudgetsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = (await searchParams) || {};
  const view = sp.view === "tee" ? "tee" : "bau";
  if (!canExport(session)) return <Restricted title="Departmental Budgets" />;

  const [list, departments, myDept, objectives, projects] = await Promise.all([
    listBudgets({}),
    listDepartments(),
    getUserDepartment(session.id),
    listObjectives(),
    getBusinessProjects().catch(() => ({ projects: [] })),
  ]);
  // Live Business Projects a project budget can be assigned to (exclude finished).
  // getBusinessProjects returns { ready, projects: [...] }, so read .projects.
  const businessProjects = ((projects && projects.projects) || [])
    .filter((p) => p.status !== "Done" && p.status !== "Complete")
    .map((p) => ({ id: p.id, name: p.name, status: p.status }));

  const isAdminFinance = hasRole(session, "ADMIN", "FINANCE");
  const deptNames = departments.map((d) => d.department_name);

  // T&E: the departments this person loads budgets for, and each one's budget.
  const thisYear = new Date().getFullYear();
  const teeYear = Number(sp.year) || thisYear;
  let tee = null;
  if (view === "tee" && list.ready) {
    const headed = isAdminFinance ? [] : await departmentsHeadedBy(session.email).catch(() => []);
    const mine = teeUploadDepartments({ isFinance: isAdminFinance, headed, myDept, departments: deptNames });
    tee = { departments: mine, rows: await teeBudgetOverview(teeYear, mine).catch(() => []) };
  }

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <ScreenWatermark text={confidentialStamp(session, new Date())} />
      <PageHeader crumb="Plan — HO" title="Departmental Budgets"
        right="Build, phase and sign off a department's budget for the year" />
      <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line)", marginBottom: 18 }}>
        {VIEWS.map(([k, label]) => (
          <a key={k} href={k === "tee" ? "?view=tee" : "?"} style={{
            padding: "8px 12px", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap",
            color: k === view ? "var(--ink)" : "var(--muted)", fontWeight: k === view ? 650 : 500,
            borderBottom: k === view ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1,
          }}>{label}</a>
        ))}
      </nav>
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Departmental Budgets needs migration <span style={{ fontFamily: "var(--mono)" }}>049_dept_budget.sql</span> (idempotent). Run it, refresh, then create your first budget.
        </EmptyState>
      ) : (
        <>
        {tee && <TeeBudgets year={teeYear} years={[thisYear - 1, thisYear, thisYear + 1]} rows={tee.rows} canUpload={tee.departments.length > 0} />}
        <DeptBudgetUI
          key={view}
          scope={view === "tee" ? "TEE" : "BAU"}
          openId={sp.open || null}
          initialBudgets={list.budgets}
          departments={deptNames}
          myDept={myDept}
          isAdminFinance={isAdminFinance}
          me={session.email || session.name}
          initialObjectives={objectives}
          businessProjects={businessProjects}
        />
        </>
      )}
    </div>
  );
}
