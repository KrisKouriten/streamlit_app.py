import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getInventoryHealth } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, IllustrativeBanner, Bar, money, pct } from "../ui";

export const dynamic = "force-dynamic";

// Inventory — illustrative until the stock feed is connected. Honest scaffold:
// full layout (value, ageing, cover, availability) on clearly-badged demo data,
// so the real feed drops straight in.
export default async function Inventory() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getInventoryHealth();
  const total = rows.reduce((s, r) => s + Number(r.stock_value || 0), 0);
  const over90 = rows.reduce((s, r) => s + Number(r.over_90 || 0), 0);
  const over180 = rows.reduce((s, r) => s + Number(r.over_180 || 0), 0);
  const inTransit = rows.reduce((s, r) => s + Number(r.value_in_transit || 0), 0);
  const maxCat = rows.reduce((m, r) => Math.max(m, Number(r.stock_value || 0)), 0);
  // Ageing buckets: fresh (<90d) / 90–180d / >180d. over_90 includes over_180.
  const fresh = Math.max(0, total - over90);
  const mid = Math.max(0, over90 - over180);
  const ageing = [
    { band: "Under 90 days", value: fresh, tone: "green" },
    { band: "90–180 days", value: mid, tone: "amber" },
    { band: "Over 180 days", value: over180, tone: "red" },
  ];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operations" title="Inventory" right="Illustrative snapshot" />
      <IllustrativeBanner>
        These figures are illustrative — no live stock feed is connected yet. Load a stock extract through the
        governed data pipeline (by category, ageing and cover) and the real position replaces them here.
      </IllustrativeBanner>

      <StatRow>
        <Stat label="Stock value" value={money(total, { compact: true })} />
        <Stat label="Over 180 days" value={money(over180, { compact: true })} tone={over180 > 0 ? "amber" : "green"} sub={total ? `${pct(over180 / total, 0)} of stock` : undefined} />
        <Stat label="In transit" value={money(inTransit, { compact: true })} />
        <Stat label="Aged (>90d)" value={total ? pct(over90 / total, 0) : "—"} tone={over90 / total > 0.2 ? "amber" : "green"} sub="share of stock value" />
      </StatRow>

      <Panel title="Stock ageing" note="value by age band">
        <Table
          columns={[
            { label: "Age band", render: (r) => r.band },
            { label: "Value", align: "right", tone: (r) => r.tone, render: (r) => money(r.value) },
            { label: "% of stock", align: "right", render: (r) => (total ? pct(r.value / total, 0) : "—") },
            { label: "", align: "right", render: (r) => <Bar value={r.value} max={total} tone={r.tone} /> },
          ]}
          rows={ageing}
        />
      </Panel>

      <Panel title="Inventory health by category" note="value, ageing, cover and availability">
        <Table
          columns={[
            { label: "Category", render: (r) => r.category },
            { label: "Stock value", align: "right", render: (r) => money(r.stock_value) },
            { label: "", align: "right", render: (r) => <Bar value={r.stock_value} max={maxCat} /> },
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
