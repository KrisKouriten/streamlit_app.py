import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getManagementVariance } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, pct, varianceTone } from "../ui";

export const dynamic = "force-dynamic";

export default async function ManagementAccounts() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getManagementVariance();
  // Favourable variance depends on whether the account is income or cost.
  const favUp = (r) => Number(r.natural_sign) >= 0;
  const revenue = rows.find((r) => Number(r.natural_sign) >= 0) || {};
  const totActual = rows.reduce((s, r) => s + Number(r.actual_amount || 0), 0);
  const totBudget = rows.reduce((s, r) => s + Number(r.budget_amount || 0), 0);
  const opVar = totActual - totBudget;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Performance management" title="Management Accounts" right="Latest actual period" />

      <StatRow>
        <Stat label="Revenue (actual)" value={money(revenue.actual_amount, { compact: true })}
          sub={`Budget ${money(revenue.budget_amount, { compact: true })}`} />
        <Stat label="Operating result" value={money(totActual, { compact: true })}
          sub={`Budget ${money(totBudget, { compact: true })}`} />
        <Stat label="Actual vs budget" value={money(opVar, { compact: true })} tone={varianceTone(opVar)}
          sub="Operating result" />
      </StatRow>

      <Panel title="Variance to budget" note="actual vs budget, by account">
        <Table
          columns={[
            { label: "Account", render: (r) => r.account_name },
            { label: "Actual", align: "right", render: (r) => money(r.actual_amount) },
            { label: "Budget", align: "right", render: (r) => money(r.budget_amount) },
            { label: "Variance", align: "right",
              tone: (r) => varianceTone(r.actual_vs_budget, favUp(r)),
              render: (r) => money(r.actual_vs_budget) },
            { label: "Var %", align: "right",
              tone: (r) => varianceTone(r.actual_vs_budget, favUp(r)),
              render: (r) => (r.actual_vs_budget_pct == null ? "—" : pct(r.actual_vs_budget_pct)) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
