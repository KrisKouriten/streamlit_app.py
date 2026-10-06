import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { canSeeEcom } from "../../../lib/ecom-access";
import { getEcomPnl, getEcomMonthly } from "../../../lib/ecom";
import { Panel, Table, SubNav, EmptyState, FilterBar } from "../../finance-os/ui";
import Restricted from "../../restricted";
import { ECOM_NAV, EcomHeader, Tile, Tiles, PeriodPicker, signedPct, toneOf, dec, money, pct, ymLabel } from "../ecom-ui";

export const dynamic = "force-dynamic";

/*
 * E-COM P&L, fees & marketing — the E-Commerce entity's monthly management
 * accounts (Joiin), laid out as the drivers of online profit: gross margin,
 * payment fees, marketing (and its return, ROAS), other costs and the
 * contribution left. The accounts' sales are tied back to the daily sheet's
 * E-COM line month by month, so a gap between the two is seen, not assumed.
 */
export default async function EcomPnl({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canSeeEcom(session.roles)) return <Restricted title="E-COM reporting" />;

  const sp = (await searchParams) || {};
  const pnl = await getEcomPnl(Number(sp.y) || null);
  if (!pnl.loaded) {
    return (
      <div className="fos-shell">
        <EcomHeader title="E-COM P&L, Fees & Marketing" />
        <SubNav items={ECOM_NAV} active="/ho-ecom/pnl" />
        <EmptyState title="No E-Commerce management accounts loaded yet">
          This page reads the E-Commerce entity&rsquo;s monthly P&amp;L from the management accounts feed (Joiin). It fills in once that feed has been refreshed.
        </EmptyState>
      </div>
    );
  }
  const daily = await getEcomMonthly(pnl.year).catch(() => []);
  const dailyBy = new Map(daily.map((m) => [m.ym, m.actual?.net ?? null]));

  const T = pnl.months.reduce((a, m) => ({
    sales: a.sales + m.sales, cogs: a.cogs + m.cogs, gp: a.gp + m.grossProfit, fees: a.fees + m.fees,
    mkt: a.mkt + m.marketing, other: a.other + m.other, contribution: a.contribution + m.contribution,
  }), { sales: 0, cogs: 0, gp: 0, fees: 0, mkt: 0, other: 0, contribution: 0 });
  const of = (v) => (T.sales ? v / T.sales : null);

  const rows = pnl.months.map((m) => ({ ...m, label: ymLabel(m.ym), daily: dailyBy.get(m.ym) ?? null }));
  rows.push({ label: "Total", total: true, sales: T.sales, cogs: T.cogs, grossProfit: T.gp, gmPct: of(T.gp), fees: T.fees, feesPct: of(T.fees),
    marketing: T.mkt, marketingPct: of(T.mkt), roas: T.mkt ? T.sales / T.mkt : null, other: T.other, contribution: T.contribution, contributionPct: of(T.contribution),
    daily: rows.reduce((t, r) => t + (r.daily || 0), 0) || null });

  // The year's fee, marketing and other cost lines, largest first.
  const lineTotals = (bucket) => {
    const by = {};
    for (const m of pnl.months) for (const l of m.lines[bucket]) by[l.account] = (by[l.account] || 0) + l.value;
    return Object.entries(by).map(([account, value]) => ({ account, value, share: of(value) })).sort((a, b) => b.value - a.value);
  };
  const lineCols = [
    { label: "Account", render: (r) => r.account },
    { label: "Year to date", align: "right", render: (r) => money(r.value) },
    { label: "% of sales", align: "right", render: (r) => (r.share == null ? "—" : pct(r.share, 2)) },
  ];

  return (
    <div className="fos-shell">
      <EcomHeader title="E-COM P&L, Fees & Marketing" right={`Management accounts to ${ymLabel(pnl.months[pnl.months.length - 1]?.ym || `${pnl.year}-01`)}`} />
      <SubNav items={ECOM_NAV} active="/ho-ecom/pnl" />
      <FilterBar label="Year">
        <PeriodPicker name="y" value={String(pnl.year)} options={pnl.years.map(String)} label="" />
      </FilterBar>

      <Tiles>
        <Tile label="Sales" value={money(T.sales, { compact: true })} />
        <Tile label="Gross margin" value={of(T.gp) == null ? "—" : pct(of(T.gp))} sub={money(T.gp, { compact: true })} />
        <Tile label="Fees % of sales" value={of(T.fees) == null ? "—" : pct(of(T.fees), 2)} sub={money(T.fees, { compact: true })} />
        <Tile label="Marketing % of sales" value={of(T.mkt) == null ? "—" : pct(of(T.mkt))} sub={money(T.mkt, { compact: true })} />
        <Tile label="ROAS" value={T.mkt ? `${dec(T.sales / T.mkt, 1)}×` : "—"} sub="£ sales per £1 marketing" />
        <Tile label="Contribution" value={money(T.contribution, { compact: true })} tone={toneOf(T.contribution)} sub={of(T.contribution) == null ? null : `${pct(of(T.contribution))} of sales`} />
      </Tiles>

      <Panel title={`${pnl.year} by month`} note="net of VAT · costs as positive figures">
        <Table columns={[
          { label: "Month", render: (r) => (r.total ? <strong>{r.label}</strong> : r.label) },
          { label: "Sales", align: "right", render: (r) => money(r.sales) },
          { label: "Gross profit", align: "right", render: (r) => money(r.grossProfit) },
          { label: "GM %", align: "right", render: (r) => (r.gmPct == null ? "—" : pct(r.gmPct)) },
          { label: "Fees", align: "right", render: (r) => money(r.fees) },
          { label: "Fees %", align: "right", render: (r) => (r.feesPct == null ? "—" : pct(r.feesPct, 2)) },
          { label: "Marketing", align: "right", render: (r) => money(r.marketing) },
          { label: "Mkt %", align: "right", render: (r) => (r.marketingPct == null ? "—" : pct(r.marketingPct)) },
          { label: "ROAS", align: "right", render: (r) => (r.roas == null ? "—" : `${dec(r.roas, 1)}×`) },
          { label: "Other costs", align: "right", render: (r) => money(r.other) },
          { label: "Contribution", align: "right", tone: (r) => (r.contribution >= 0 ? "green" : "red"), render: (r) => money(r.contribution) },
          { label: "Contrib %", align: "right", render: (r) => (r.contributionPct == null ? "—" : pct(r.contributionPct)) },
        ]} rows={rows} />
      </Panel>

      <Panel title="Accounts vs the daily sheet" note="sales in the management accounts against the E-COM line of the daily store sales sheet">
        <Table columns={[
          { label: "Month", render: (r) => (r.total ? <strong>{r.label}</strong> : r.label) },
          { label: "Accounts", align: "right", render: (r) => money(r.sales) },
          { label: "Daily sheet", align: "right", render: (r) => (r.daily == null ? "—" : money(r.daily)) },
          { label: "Difference", align: "right", tone: (r) => (r.daily == null ? "muted" : Math.abs(r.sales - r.daily) <= Math.max(1, Math.abs(r.sales) * 0.01) ? "green" : "amber"),
            render: (r) => (r.daily == null ? "—" : money(r.sales - r.daily)) },
          { label: "Diff %", align: "right", render: (r) => (r.daily ? signedPct(r.sales / r.daily - 1) : "—") },
        ]} rows={rows} />
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
        <Panel title="Fees" note="payment and platform charges"><Table columns={lineCols} rows={lineTotals("fees")} empty="No fee lines." /></Panel>
        <Panel title="Marketing" note="advertising and marketing"><Table columns={lineCols} rows={lineTotals("marketing")} empty="No marketing lines." /></Panel>
      </div>
      <Panel title="Other costs" note="every other E-COM cost line"><Table columns={lineCols} rows={lineTotals("other")} empty="No other cost lines." /></Panel>
    </div>
  );
}
