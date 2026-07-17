import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getInventoryHealth } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getInventoryHealth();
  const total = rows.reduce((s, r) => s + Number(r.stock_value || 0), 0);
  const over180 = rows.reduce((s, r) => s + Number(r.over_180 || 0), 0);
  const inTransit = rows.reduce((s, r) => s + Number(r.value_in_transit || 0), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Inventory" right="Latest snapshot" />

      <StatRow>
        <Stat label="Stock value" value={money(total, { compact: true })} />
        <Stat label="Over 180 days" value={money(over180, { compact: true })} tone={over180 > 0 ? "amber" : "green"} />
        <Stat label="In transit" value={money(inTransit, { compact: true })} />
      </StatRow>

      <Panel title="Inventory health by category" note="value, ageing, cover and availability">
        <Table
          columns={[
            { label: "Category", render: (r) => r.category },
            { label: "Stock value", align: "right", render: (r) => money(r.stock_value) },
            { label: "> 90 days", align: "right", render: (r) => money(r.over_90) },
            { label: "> 180 days", align: "right",
              tone: (r) => (Number(r.over_180) > 0 ? "amber" : "green"),
              render: (r) => money(r.over_180) },
            { label: "Weeks cover", align: "right", render: (r) => (r.weeks_cover == null ? "—" : Number(r.weeks_cover).toFixed(1)) },
            { label: "Availability", align: "right", render: (r) => pct(r.availability) },
            { label: "Sell-through", align: "right", render: (r) => pct(r.sell_through) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
