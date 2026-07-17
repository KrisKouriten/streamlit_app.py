import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getStorePerformance } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, num, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function StoreSales() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getStorePerformance();
  const totalSales = rows.reduce((s, r) => s + Number(r.net_sales || 0), 0);
  const totalEbitda = rows.reduce((s, r) => s + Number(r.ebitda || 0), 0);
  const avgMarginPct = totalSales
    ? rows.reduce((s, r) => s + Number(r.gross_margin || 0), 0) / totalSales
    : null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Store Sales & KPI" right="Latest month" />

      <StatRow>
        <Stat label="Net sales" value={money(totalSales, { compact: true })} sub={`${rows.length} stores`} />
        <Stat label="Store EBITDA" value={money(totalEbitda, { compact: true })} />
        <Stat label="Gross margin %" value={pct(avgMarginPct)} />
      </StatRow>

      <Panel title="Store performance" note="net sales, margin, EBITDA and productivity">
        <Table
          columns={[
            { label: "Store", render: (r) => r.store_name },
            { label: "Region", render: (r) => r.region || "—" },
            { label: "Net sales", align: "right", render: (r) => money(r.net_sales) },
            { label: "Gross margin", align: "right", render: (r) => money(r.gross_margin) },
            { label: "EBITDA", align: "right", render: (r) => money(r.ebitda) },
            { label: "£/sq ft", align: "right",
              render: (r) => (r.ownership_type === "ECOMMERCE" ? "n/a" : money(r.sales_per_sqft)) },
            { label: "Fcst acc.", align: "right", render: (r) => pct(r.forecast_accuracy) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
