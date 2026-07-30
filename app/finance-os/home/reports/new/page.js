import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../../../lib/auth";
import { listTemplates, getTemplate } from "../../../../../lib/reporting/templates";
import { listBudgets, getUserDepartment } from "../../../../../lib/dept-budget";
import { PageHeader, EmptyState } from "../../../ui";
import Wizard from "./wizard";

export const dynamic = "force-dynamic";

// The seeded Departmental Budget Pack (migration 059). When this template is
// chosen the wizard asks the budget holder which departmental budget to build
// the pack from — the same budgets that drive Dashboards › Departmental Budgets
// and the P.O approvals.
const DEPT_BUDGET_TEMPLATE = "DEPT_BUDGET_PACK";

export default async function NewReport({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return <div style={{ padding: "1rem 0" }}><PageHeader crumb="New report" title="New report" /><EmptyState title="Access required">Creating reports needs finance or admin access.</EmptyState></div>;
  }
  const sp = await searchParams;
  const { templates } = await listTemplates();
  const selected = sp?.template || templates[0]?.template_key || null;
  const tpl = selected ? await getTemplate(selected) : null;

  // Departmental budgets available to build the pack from, plus the caller's own
  // department so a budget holder lands on theirs by default. Finance/admin (the
  // only roles that reach this screen) may pick any department; a budget holder
  // is pinned to their own.
  const [{ budgets }, myDepartment] = await Promise.all([
    listBudgets().catch(() => ({ budgets: [] })),
    getUserDepartment(session.id).catch(() => null),
  ]);
  const canPickAnyDept = hasRole(session, "ADMIN", "FINANCE");

  return (
    <div style={{ padding: "1rem 0" }}>
      <PageHeader crumb="New report" title="Create a report" right="Step 1 — report details" />
      <Wizard
        templates={templates.map((t) => ({ key: t.template_key, name: t.name, confidentiality: t.default_confidentiality, audience: t.audience }))}
        selected={selected}
        defaults={tpl ? { name: tpl.name, audience: tpl.audience, confidentiality: tpl.default_confidentiality } : null}
        owner={session.email || session.name}
        deptBudgetTemplate={DEPT_BUDGET_TEMPLATE}
        budgets={(budgets || []).map((b) => ({ budgetId: b.budget_id, department: b.department, year: b.budget_year, versionLabel: b.version_label, status: b.status }))}
        myDepartment={myDepartment}
        canPickAnyDept={canPickAnyDept}
      />
    </div>
  );
}
