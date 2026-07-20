import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getFranchise } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, IllustrativeBanner, Badge, Bar, money, pct } from "../ui";

export const dynamic = "force-dynamic";

// Franchise — illustrative until the franchise ledger feed is connected. Honest
// scaffold: sales, collection, receivables risk and profitability on badged
// demo data, so a real extract drops in cleanly.
export default async function Franchise() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getFranchise();
  const invoiced = rows.reduce((s, r) => s + Number(r.invoiced_sales || 0), 0);
  const cash = rows.reduce((s, r) => s + Number(r.cash_received || 0), 0);
  const overdue = rows.reduce((s, r) => s + Number(r.overdue_receivable || 0), 0);
  const ebitda = rows.reduce((s, r) => s + Number(r.franchise_ebitda || 0), 0);
  const maxInv = rows.reduce((m, r) => Math.max(m, Number(r.invoiced_sales || 0)), 0);
  const collection = invoiced ? cash / invoiced : null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operations" title="Franchise" right="Illustrative period" />
      <IllustrativeBanner>
        These figures are illustrative — no live franchise ledger is connected yet. Load a franchise extract
        (invoiced sales, cash, receivables and credit) through the governed pipeline and the real position replaces them.
      </IllustrativeBanner>

      <StatRow>
        <Stat label="Invoiced sales" value={money(invoiced, { compact: true })} sub={`${rows.length} franchise stores`} />
        <Stat label="Collection" value={collection == null ? "—" : pct(collection, 0)} tone={collection >= 0.9 ? "green" : "amber"} sub="cash received / invoiced" />
        <Stat label="Overdue receivables" value={money(overdue, { compact: true })} tone={overdue > 0 ? "amber" : "green"} />
        <Stat label="Franchise EBITDA" value={money(ebitda, { compact: true })} />
      </StatRow>

      <Panel title="Franchise performance" note="sales, receivables, credit and profitability">
        <Table
          columns={[
            { label: "Store", render: (r) => r.store_name },
            { label: "Invoiced", align: "right", render: (r) => money(r.invoiced_sales) },
            { label: "", align: "right", render: (r) => <Bar value={r.invoiced_sales} max={maxInv} /> },
            { label: "Cash recd", align: "right", render: (r) => money(r.cash_received) },
            { label: "Receivable", align: "right", render: (r) => money(r.closing_receivable) },
            { label: "Overdue", align: "right",
              render: (r) => (Number(r.overdue_receivable) > 0
                ? <Badge tone="amber">{money(r.overdue_receivable)}</Badge>
                : <span style={{ color: "var(--faint)" }}>—</span>) },
            { label: "EBITDA", align: "right", tone: (r) => (Number(r.franchise_ebitda) >= 0 ? undefined : "red"), render: (r) => money(r.franchise_ebitda) },
            { label: "Credit limit", align: "right", render: (r) => money(r.credit_limit) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
