import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getFixedAssets } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, IllustrativeBanner, Bar, money, pct } from "../ui";

export const dynamic = "force-dynamic";

// Fixed Assets — illustrative until the asset register feed is connected. Honest
// scaffold: cost, depreciation, NBV and return, with a category rollup, on badged
// demo data so a real register drops in cleanly.
export default async function FixedAssets() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getFixedAssets();
  const cost = rows.reduce((s, r) => s + Number(r.original_cost || 0), 0);
  const nbv = rows.reduce((s, r) => s + Number(r.closing_nbv || 0), 0);
  const dep = rows.reduce((s, r) => s + Number(r.depreciation || 0), 0);

  // Category rollup.
  const byCat = {};
  for (const r of rows) {
    const k = r.asset_category || "Uncategorised";
    (byCat[k] ||= { asset_category: k, count: 0, original_cost: 0, closing_nbv: 0, depreciation: 0 });
    byCat[k].count += 1;
    byCat[k].original_cost += Number(r.original_cost || 0);
    byCat[k].closing_nbv += Number(r.closing_nbv || 0);
    byCat[k].depreciation += Number(r.depreciation || 0);
  }
  const cats = Object.values(byCat).sort((a, b) => b.closing_nbv - a.closing_nbv);
  const maxCatNbv = cats.reduce((m, c) => Math.max(m, c.closing_nbv), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Financial reporting" title="Fixed Assets" right="Illustrative month" />
      <IllustrativeBanner>
        These figures are illustrative — no live asset register is connected yet. Load the register (cost,
        depreciation, NBV and return) through the governed pipeline and the real position replaces them here.
      </IllustrativeBanner>

      <StatRow>
        <Stat label="Original cost" value={money(cost, { compact: true })} sub={`${rows.length} assets`} />
        <Stat label="Net book value" value={money(nbv, { compact: true })} sub={cost ? `${pct(nbv / cost, 0)} of cost remaining` : undefined} />
        <Stat label="Monthly depreciation" value={money(dep)} />
        <Stat label="Categories" value={cats.length} sub="asset classes" />
      </StatRow>

      <Panel title="By category" note="cost, book value and monthly depreciation">
        <Table
          columns={[
            { label: "Category", render: (r) => r.asset_category },
            { label: "Assets", align: "right", render: (r) => r.count },
            { label: "Cost", align: "right", render: (r) => money(r.original_cost) },
            { label: "NBV", align: "right", render: (r) => money(r.closing_nbv) },
            { label: "", align: "right", render: (r) => <Bar value={r.closing_nbv} max={maxCatNbv} /> },
            { label: "Depr. (mth)", align: "right", render: (r) => money(r.depreciation) },
          ]}
          rows={cats}
        />
      </Panel>

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
