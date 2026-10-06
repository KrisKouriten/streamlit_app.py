import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { canSeeEcom } from "../../lib/ecom-access";
import { getEcomFeed, getEcomPeriod, getEcomMonthly, getEcomPnl } from "../../lib/ecom";
import { ecomKpis, growth } from "../../lib/ecom-rules";
import { Panel, Table, SubNav, EmptyState, dateLabel } from "../finance-os/ui";
import Restricted from "../restricted";
import { ECOM_NAV, EcomHeader, Tile, Tiles, signedPct, toneOf, gbp2, dec, whole, money, pct, ymLabel } from "./ecom-ui";

export const dynamic = "force-dynamic";

/*
 * E-COM Dashboard — the online channel on the same footing as the Store Sales
 * & KPI dashboard: this week, month to date and year to date against the live
 * forecast and last year, then the year month by month. Orders, AOV, units,
 * conversion, margin and returns come from the E-COM line of the daily store
 * sales sheet; fees and marketing from the monthly management accounts.
 */

function PeriodBlock({ title, range, p }) {
  const k = ecomKpis(p.cy), ly = ecomKpis(p.py);
  const vsFc = p.forecast ? p.cy.net / p.forecast - 1 : null;
  const fcGap = p.cy.net - (p.forecast || 0);
  const share = p.companyStores + p.cy.net ? p.cy.net / (p.companyStores + p.cy.net) : null;
  const rows = [
    { kpi: "Net sales", cy: money(k.net), ly: money(ly.net), ch: growth(k.net, ly.net) },
    { kpi: "Orders", cy: whole(k.orders), ly: whole(ly.orders), ch: growth(k.orders, ly.orders) },
    { kpi: "Average order value", cy: gbp2(k.aov), ly: gbp2(ly.aov), ch: growth(k.aov, ly.aov) },
    { kpi: "Units", cy: whole(k.units), ly: whole(ly.units), ch: growth(k.units, ly.units) },
    { kpi: "Units per order", cy: dec(k.unitsPerOrder), ly: dec(ly.unitsPerOrder), ch: growth(k.unitsPerOrder, ly.unitsPerOrder) },
    { kpi: "Sessions", cy: k.sessions == null ? "—" : whole(k.sessions), ly: ly.sessions == null ? "—" : whole(ly.sessions), ch: growth(k.sessions, ly.sessions) },
    { kpi: "Conversion", cy: k.conversion == null ? "—" : pct(k.conversion, 2), ly: ly.conversion == null ? "—" : pct(ly.conversion, 2), ch: k.conversion != null && ly.conversion != null ? k.conversion - ly.conversion : null, pts: true },
    { kpi: "Margin %", cy: k.marginPct == null ? "—" : pct(k.marginPct), ly: ly.marginPct == null ? "—" : pct(ly.marginPct), ch: k.marginPct != null && ly.marginPct != null ? k.marginPct - ly.marginPct : null, pts: true },
    { kpi: "Return rate (orders)", cy: k.returnRate == null ? "—" : pct(k.returnRate), ly: ly.returnRate == null ? "—" : pct(ly.returnRate), ch: k.returnRate != null && ly.returnRate != null ? k.returnRate - ly.returnRate : null, pts: true, down: true },
  ];
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{title}</div>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>{range}</span>
      </div>
      <Tiles>
        <Tile label="Net sales" value={money(k.net, { compact: true })} sub={`LY ${money(ly.net, { compact: true })}`} />
        <Tile label="vs forecast" value={signedPct(vsFc)} tone={toneOf(vsFc)} sub={p.forecast ? `${fcGap >= 0 ? "+" : "−"}${money(Math.abs(fcGap), { compact: true })} · fc ${money(p.forecast, { compact: true })}` : "no forecast"} />
        <Tile label="vs last year" value={signedPct(growth(k.net, ly.net))} tone={toneOf(growth(k.net, ly.net))} />
        <Tile label="Orders" value={whole(k.orders)} sub={`${signedPct(growth(k.orders, ly.orders))} vs LY`} subTone={toneOf(growth(k.orders, ly.orders))} />
        <Tile label="AOV" value={gbp2(k.aov)} sub={`${signedPct(growth(k.aov, ly.aov))} vs LY`} subTone={toneOf(growth(k.aov, ly.aov))} />
        <Tile label="Conversion" value={k.conversion == null ? "—" : pct(k.conversion, 2)} sub={k.conversion == null ? "no sessions in the feed" : `${whole(k.sessions)} sessions`} />
        <Tile label="Margin %" value={k.marginPct == null ? "—" : pct(k.marginPct)} sub={money(k.gm, { compact: true })} />
        <Tile label="Share of company sales" value={share == null ? "—" : pct(share)} sub="E-COM ÷ (company stores + E-COM)" />
      </Tiles>
      <Table columns={[
        { label: "KPI", render: (r) => r.kpi },
        { label: "This year", align: "right", render: (r) => r.cy },
        { label: "Last year", align: "right", render: (r) => r.ly },
        { label: "Change", align: "right", tone: (r) => (r.ch == null ? "muted" : (r.down ? r.ch <= 0 : r.ch >= 0) ? "green" : "red"),
          render: (r) => (r.ch == null ? "—" : r.pts ? `${r.ch >= 0 ? "+" : "−"}${Math.abs(r.ch * 100).toFixed(2)} pts` : signedPct(r.ch)) },
      ]} rows={rows} />
    </section>
  );
}

function Monthly({ year, months }) {
  const traded = months.filter((m) => m.actual);
  const sum = (sel) => months.reduce((t, m) => t + (sel(m) || 0), 0);
  const tAct = sum((m) => m.actual?.net), tFcTraded = traded.reduce((t, m) => t + (m.forecastCompare || 0), 0), tPy = traded.reduce((t, m) => t + (m.py?.net || 0), 0);
  const tOrders = sum((m) => m.actual?.orders);
  const rows = months.map((m) => {
    const k = m.actual ? ecomKpis(m.actual) : null;
    return {
      label: m.partial ? `${ymLabel(m.ym)} (to date)` : ymLabel(m.ym), actual: m.actual?.net ?? null, forecast: m.forecast, py: m.py?.net ?? null,
      vsFc: m.actual && m.forecastCompare ? m.actual.net / m.forecastCompare - 1 : null,
      vsPy: m.actual ? growth(m.actual.net, m.py?.net) : null,
      orders: k?.orders ?? null, aov: k?.aov ?? null, conv: k?.conversion ?? null, margin: k?.marginPct ?? null,
    };
  });
  rows.push({ label: "Total (traded months)", total: true, actual: tAct, forecast: tFcTraded, py: tPy,
    vsFc: tFcTraded ? tAct / tFcTraded - 1 : null, vsPy: growth(tAct, tPy), orders: tOrders, aov: tOrders ? tAct / tOrders : null, conv: null, margin: null });
  return (
    <Panel title={`${year} by month`} note="actual vs the live forecast and last year · the month in progress is compared to the same date · later months show forecast only">
      <Table columns={[
        { label: "Month", render: (r) => (r.total ? <strong>{r.label}</strong> : r.label) },
        { label: "Actual", align: "right", render: (r) => (r.actual == null ? "—" : money(r.actual)) },
        { label: "Forecast", align: "right", render: (r) => (r.forecast == null ? "—" : money(r.forecast)) },
        { label: "vs fc", align: "right", tone: (r) => (r.vsFc == null ? "muted" : r.vsFc >= 0 ? "green" : "red"), render: (r) => signedPct(r.vsFc) },
        { label: "Last year", align: "right", render: (r) => (r.py == null ? "—" : money(r.py)) },
        { label: "vs LY", align: "right", tone: (r) => (r.vsPy == null ? "muted" : r.vsPy >= 0 ? "green" : "red"), render: (r) => signedPct(r.vsPy) },
        { label: "Orders", align: "right", render: (r) => whole(r.orders) },
        { label: "AOV", align: "right", render: (r) => gbp2(r.aov) },
        { label: "Conversion", align: "right", render: (r) => (r.conv == null ? "—" : pct(r.conv, 2)) },
        { label: "Margin %", align: "right", render: (r) => (r.margin == null ? "—" : pct(r.margin)) },
      ]} rows={rows} />
    </Panel>
  );
}

function MaSummary({ pnl }) {
  if (!pnl.loaded || !pnl.months.length) return null;
  const t = pnl.months.reduce((a, m) => ({ sales: a.sales + m.sales, gp: a.gp + m.grossProfit, fees: a.fees + m.fees, mkt: a.mkt + m.marketing, contribution: a.contribution + m.contribution }), { sales: 0, gp: 0, fees: 0, mkt: 0, contribution: 0 });
  const of = (v) => (t.sales ? v / t.sales : null);
  const last = pnl.months[pnl.months.length - 1];
  return (
    <Panel title={`Margin, fees & marketing · ${pnl.year} to ${ymLabel(last.ym)}`} note="from the E-Commerce management accounts — see P&L, fees & marketing">
      <Tiles>
        <Tile label="Sales (accounts)" value={money(t.sales, { compact: true })} />
        <Tile label="Gross margin" value={of(t.gp) == null ? "—" : pct(of(t.gp))} sub={money(t.gp, { compact: true })} />
        <Tile label="Fees % of sales" value={of(t.fees) == null ? "—" : pct(of(t.fees))} sub={`${money(t.fees, { compact: true })} PayPal / merchant`} />
        <Tile label="Marketing % of sales" value={of(t.mkt) == null ? "—" : pct(of(t.mkt))} sub={money(t.mkt, { compact: true })} />
        <Tile label="ROAS" value={t.mkt ? `${dec(t.sales / t.mkt, 1)}×` : "—"} sub="£ sales per £1 marketing" />
        <Tile label="Contribution" value={money(t.contribution, { compact: true })} tone={toneOf(t.contribution)} sub={of(t.contribution) == null ? null : `${pct(of(t.contribution))} of sales`} />
      </Tiles>
    </Panel>
  );
}

export default async function EcomDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canSeeEcom(session.roles)) return <Restricted title="E-COM reporting" />;

  const feed = await getEcomFeed();
  const wins = feed.windows;
  if (!feed.stores.length || !wins) {
    return (
      <div className="fos-shell">
        <EcomHeader title="E-COM Dashboard" />
        <SubNav items={ECOM_NAV} active="/ho-ecom" />
        <EmptyState title={feed.stores.length ? "No E-COM trading loaded yet" : "No E-COM line in the store sales feed"}>
          E-COM is read from the daily store sales sheet, from the line named <strong>E-COM</strong> (or E-Commerce).
          {feed.stores.length ? " That line is set up but has no trading days yet." : " Once the sheet carrying it is uploaded on Data → Uploads, this dashboard fills in."}
        </EmptyState>
      </div>
    );
  }
  const year = Number(wins.ytd.toDate.slice(0, 4));
  const [week, mtd, ytd, months, pnl] = await Promise.all([
    getEcomPeriod(wins.week), getEcomPeriod(wins.mtd), getEcomPeriod(wins.ytd),
    getEcomMonthly(year, wins.maxDate), getEcomPnl(year),
  ]);
  const fmt = (w) => `${new Date(w.fromDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(w.toDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="fos-shell">
      <EcomHeader title="E-COM Dashboard" right={`Data to ${dateLabel(wins.maxDate)}`} />
      <SubNav items={ECOM_NAV} active="/ho-ecom" />

      <PeriodBlock title="This week" range={fmt(wins.week)} p={week} />
      <PeriodBlock title="Month to date" range={fmt(wins.mtd)} p={mtd} />
      <PeriodBlock title="Year to date" range={fmt(wins.ytd)} p={ytd} />

      <Monthly year={year} months={months} />
      <MaSummary pnl={pnl} />

      <Panel title="Definitions" note="one calculation everywhere">
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 16px" }}>
          E-COM is the <strong>{feed.stores.map((s) => s.store_name).join(", ")}</strong> line of the daily store sales sheet, reported here on its own and kept out of the store dashboards.
          Orders = net transactions on that line; AOV = net sales ÷ orders; units per order = units ÷ orders; conversion = orders ÷ sessions (the sheet&rsquo;s footfall column on the E-COM line); margin % = gross profit ÷ net sales; return rate = returned orders ÷ (orders + returned orders).
          Last year = the same calendar dates − 365 days. Forecast = the live version on Plan – Finance → Sales Forecast, E-COM line only.
          Share of company sales = E-COM ÷ (company stores + E-COM). Fees, marketing, ROAS (sales ÷ marketing) and contribution come from the monthly E-Commerce management accounts, so they lag the daily figures until each month is closed.
        </div>
      </Panel>
    </div>
  );
}
