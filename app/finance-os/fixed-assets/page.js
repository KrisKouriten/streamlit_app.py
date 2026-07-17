import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getFixedAssets } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function FixedAssets() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getFixedAssets();
  const cost = rows.reduce((s, r) => s + Number(r.original_cost || 0), 0);
  const nbv = rows.reduce((s, r) => s + Number(r.closing_nbv || 0), 0);
  const dep = rows.reduce((s, r) => s + Number(r.depreciation || 0), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Fixed Assets" right="Latest month" />

      <StatRow>
        <Stat label="Original cost" value={money(cost, { compact: true })} sub={`${rows.length} assets`} />
        <Stat label="Net book value" value={money(nbv, { compact: true })} />
        <Stat label="Monthly depreciation" value={money(dep)} />
      </StatRow>

      <Panel title="Asset register" note="cost, depreciation, book value and return">
        <Table
          columns={[
            { label: "Asset", render: (r) => r.asset_description },
            { label: "Category", render: (r) => r.asset_category },
            { label: "Cost", align: "right", render: (r) => money(r.original_cost) },
            { label: "Depr. (mth)", align: "right", render: (r) => money(r.depreciation) },
            { label: "NBV", align: "right", render: (r) => money(r.closing_nbv) },
            { label: "ROI", align: "right", render: (r) => pct(r.roi_pct) },
            { label: "Payback (mth)", align: "right", render: (r) => (r.payback_months == null ? "—" : Math.round(Number(r.payback_months))) },
          ]}
          rows={rows}
        />
      </Panel>
    </div>
  );
}
