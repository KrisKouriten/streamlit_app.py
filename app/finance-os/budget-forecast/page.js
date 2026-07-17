import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getBudgetForecastPL } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, varianceTone } from "../ui";

export const dynamic = "force-dynamic";

export default async function BudgetForecast() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getBudgetForecastPL();
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const revenue = rows.find((r) => r.account_group === "Revenue") || {};
  const opActual = sum("actual"), opBudget = sum("budget"), opForecast = sum("forecast");
  const fcVsBud = opForecast - opBudget;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Strategic planning" title="Budget & Forecast" right="Current fiscal year" />

      <StatRow>
        <Stat label="Revenue (forecast)" value={money(revenue.forecast, { compact: true })} sub={`Budget ${money(revenue.budget, { compact: true })}`} />
        <Stat label="Operating result (forecast)" value={money(opForecast, { compact: true })} sub={`Budget ${money(opBudget, { compact: true })}`} />
        <Stat label="Forecast vs budget" value={money(fcVsBud, { compact: true })} tone={varianceTone(fcVsBud)} sub="Operating result" />
      </StatRow>

      <Panel title="Full-year P&L" note="actual / budget / forecast at a common grain">
        <Table
          columns={[
            { label: "Account", render: (r) => r.account_name },
            { label: "Actual", align: "right", render: (r) => money(r.actual) },
            { label: "Budget", align: "right", render: (r) => money(r.budget) },
            { label: "Forecast", align: "right", render: (r) => money(r.forecast) },
            { label: "Fcst vs Bud", align: "right",
              tone: (r) => varianceTone(Number(r.forecast) - Number(r.budget)),
              render: (r) => money(Number(r.forecast) - Number(r.budget)) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
