import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { listMiscSpend } from "../../../lib/misc-spend";
import { listBudgets } from "../../../lib/dept-budget";
import { listDepartments } from "../../../lib/governance";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import MiscSpendUI from "./misc-spend-ui";

export const dynamic = "force-dynamic";

// Miscellaneous spend (Plan — HO) — log small PROJECT spend that doesn't
// warrant a P.O, by category, against a Project budget. Business-as-usual
// spend is claimed through expenses (Expense Claims), so it is not logged here.
export default async function MiscSpendPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [list, budgets, departments] = await Promise.all([
    listMiscSpend({}),
    listBudgets({}),
    listDepartments(),
  ]);

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan — HO" title="Miscellaneous Spend"
        right="Project spend that doesn't need a P.O — business-as-usual expenses go through Expense Claims" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Miscellaneous Spend needs migration <span style={{ fontFamily: "var(--mono)" }}>103_misc_spend.sql</span> (idempotent). Run it, refresh, then log your first entry.
        </EmptyState>
      ) : (
        <MiscSpendUI
          initialRows={list.rows}
          budgets={(budgets.budgets || []).map((b) => ({
            id: b.budget_id, department: b.department, year: b.budget_year,
            version: b.version_label, type: b.budget_type, project: b.project_name,
          }))}
          departments={departments.map((d) => d.department_name)}
          me={session.email || session.name}
        />
      )}
    </div>
  );
}
