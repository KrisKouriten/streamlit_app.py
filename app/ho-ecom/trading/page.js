import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { canSeeEcom } from "../../../lib/ecom-access";
import { getEcomFeed, getEcomDaily, listEcomMonths, monthWindow } from "../../../lib/ecom";
import { ecomKpis, growth } from "../../../lib/ecom-rules";
import { Panel, Table, SubNav, EmptyState, FilterBar } from "../../finance-os/ui";
import Restricted from "../../restricted";
import { ECOM_NAV, EcomHeader, Tile, Tiles, PeriodPicker, signedPct, toneOf, gbp2, dec, whole, money, pct, ymLabel, dmy } from "../ecom-ui";

export const dynamic = "force-dynamic";

/*
 * E-COM daily trading — one month, day by day, with the same day last year
 * (−365 days) beside it. The drivers sit next to the sales so a good or bad
 * day can be read straight across: orders, AOV, units per order, sessions,
 * conversion, margin and returns.
 */
export default async function EcomTrading({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canSeeEcom(session.roles)) return <Restricted title="E-COM reporting" />;

  const sp = (await searchParams) || {};
  const [feed, months] = await Promise.all([getEcomFeed(), listEcomMonths()]);
  if (!months.length) {
    return (
      <div className="fos-shell">
        <EcomHeader title="E-COM Daily Trading" />
        <SubNav items={ECOM_NAV} active="/ho-ecom/trading" />
        <EmptyState title="No E-COM trading loaded yet">E-COM is read from the E-COM line of the daily store sales sheet.</EmptyState>
      </div>
    );
  }
  const ym = months.includes(sp.ym) ? sp.ym : months[0];
  const win = monthWindow(ym, feed.maxDate);
  const days = await getEcomDaily(win);

  const add = (a, b) => {
    const o = { ...a };
    for (const k of Object.keys(b || {})) o[k] = (o[k] || 0) + (b[k] || 0);
    return o;
  };
  const cyT = days.reduce((t, d) => add(t, d.cy), {});
  const pyT = days.reduce((t, d) => (d.py ? add(t, d.py) : t), {});
  const k = ecomKpis(cyT), ly = ecomKpis(pyT);
  const best = [...days].sort((a, b) => b.cy.net - a.cy.net)[0];

  const rows = days.map((d) => {
    const c = ecomKpis(d.cy), p = d.py ? ecomKpis(d.py) : null;
    return { date: d.date, dow: d.dow, net: c.net, py: p?.net ?? null, vsPy: p ? growth(c.net, p.net) : null,
      orders: c.orders, aov: c.aov, upo: c.unitsPerOrder, sessions: c.sessions, conv: c.conversion, margin: c.marginPct, returns: d.cy.returnValue };
  });
  rows.push({ total: true, date: null, dow: "", net: k.net, py: ly.net || null, vsPy: growth(k.net, ly.net),
    orders: k.orders, aov: k.aov, upo: k.unitsPerOrder, sessions: k.sessions, conv: k.conversion, margin: k.marginPct, returns: cyT.returnValue });

  return (
    <div className="fos-shell">
      <EcomHeader title="E-COM Daily Trading" right={`Data to ${dmy(feed.maxDate)}`} />
      <SubNav items={ECOM_NAV} active="/ho-ecom/trading" />
      <FilterBar label="Month">
        <PeriodPicker name="ym" value={ym} options={months} label="" render={ymLabel} />
      </FilterBar>

      <Tiles>
        <Tile label="Net sales" value={money(k.net, { compact: true })} sub={`${signedPct(growth(k.net, ly.net))} vs LY`} subTone={toneOf(growth(k.net, ly.net))} />
        <Tile label="Orders" value={whole(k.orders)} sub={`${signedPct(growth(k.orders, ly.orders))} vs LY`} subTone={toneOf(growth(k.orders, ly.orders))} />
        <Tile label="AOV" value={gbp2(k.aov)} sub={`LY ${gbp2(ly.aov)}`} />
        <Tile label="Units per order" value={dec(k.unitsPerOrder)} sub={`LY ${dec(ly.unitsPerOrder)}`} />
        <Tile label="Conversion" value={k.conversion == null ? "—" : pct(k.conversion, 2)} sub={k.conversion == null ? "no sessions in the feed" : `LY ${ly.conversion == null ? "—" : pct(ly.conversion, 2)}`} />
        <Tile label="Best day" value={best ? money(best.cy.net, { compact: true }) : "—"} sub={best ? `${best.dow} ${dmy(best.date)}` : null} />
      </Tiles>

      <Panel title={`${ymLabel(ym)} day by day`} note="last year = the same date − 365 days">
        <Table columns={[
          { label: "Date", render: (r) => (r.total ? <strong>Month total</strong> : `${r.dow} ${dmy(r.date)}`) },
          { label: "Net sales", align: "right", render: (r) => money(r.net) },
          { label: "Last year", align: "right", render: (r) => (r.py == null ? "—" : money(r.py)) },
          { label: "vs LY", align: "right", tone: (r) => (r.vsPy == null ? "muted" : r.vsPy >= 0 ? "green" : "red"), render: (r) => signedPct(r.vsPy) },
          { label: "Orders", align: "right", render: (r) => whole(r.orders) },
          { label: "AOV", align: "right", render: (r) => gbp2(r.aov) },
          { label: "Units / order", align: "right", render: (r) => dec(r.upo) },
          { label: "Sessions", align: "right", render: (r) => (r.sessions == null ? "—" : whole(r.sessions)) },
          { label: "Conversion", align: "right", render: (r) => (r.conv == null ? "—" : pct(r.conv, 2)) },
          { label: "Margin %", align: "right", render: (r) => (r.margin == null ? "—" : pct(r.margin)) },
          { label: "Returns", align: "right", render: (r) => (r.returns ? money(Math.abs(r.returns)) : "—") },
        ]} rows={rows} empty="No trading days in this month." />
      </Panel>
    </div>
  );
}
