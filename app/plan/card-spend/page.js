import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { listCardSpend } from "../../../lib/card-spend";
import { listBudgets } from "../../../lib/dept-budget";
import { listDepartments } from "../../../lib/governance";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import CardSpendUI from "./card-spend-ui";

export const dynamic = "force-dynamic";

// Card / pre-approved spend (Plan — HO) — log spend already made on a company card
// (or pre-approved) that doesn't warrant a P.O, against a Departmental Budget. It
// reports as committed spend on the Department Dashboard.
export default async function CardSpendPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [list, budgets, departments] = await Promise.all([
    listCardSpend({}),
    listBudgets({}),
    listDepartments(),
  ]);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — HO" title="Card / Pre-approved Spend"
        right="Log card or pre-approved spend against a budget — no P.O needed" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Card / Pre-approved Spend needs migration <span style={{ fontFamily: "var(--mono)" }}>112_card_spend.sql</span> (idempotent). Run it, refresh, then log your first entry.
        </EmptyState>
      ) : (
        <CardSpendUI
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
