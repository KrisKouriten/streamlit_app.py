import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getFranchise } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, varianceTone } from "../ui";

export const dynamic = "force-dynamic";

export default async function Franchise() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getFranchise();
  const invoiced = rows.reduce((s, r) => s + Number(r.invoiced_sales || 0), 0);
  const overdue = rows.reduce((s, r) => s + Number(r.overdue_receivable || 0), 0);
  const ebitda = rows.reduce((s, r) => s + Number(r.franchise_ebitda || 0), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Franchise" right="Latest period" />

      <StatRow>
        <Stat label="Invoiced sales" value={money(invoiced, { compact: true })} sub={`${rows.length} franchise stores`} />
        <Stat label="Overdue receivables" value={money(overdue, { compact: true })} tone={overdue > 0 ? "amber" : "green"} />
        <Stat label="Franchise EBITDA" value={money(ebitda, { compact: true })} />
      </StatRow>

      <Panel title="Franchise performance" note="sales, receivables, credit and profitability">
        <Table
          columns={[
            { label: "Store", render: (r) => r.store_name },
            { label: "Invoiced", align: "right", render: (r) => money(r.invoiced_sales) },
            { label: "Cash recd", align: "right", render: (r) => money(r.cash_received) },
            { label: "Receivable", align: "right", render: (r) => money(r.closing_receivable) },
            { label: "Overdue", align: "right",
              tone: (r) => (Number(r.overdue_receivable) > 0 ? "amber" : "green"),
              render: (r) => money(r.overdue_receivable) },
            { label: "EBITDA", align: "right", render: (r) => money(r.franchise_ebitda) },
            { label: "Credit limit", align: "right", render: (r) => money(r.credit_limit) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
