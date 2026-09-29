import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { getWindows, getStoreLeague, getForecastOnlyStores } from "../../../../lib/store-sales";
import { PageHeader, Panel, Table, SubNav, STORE_SALES_NAV, money, pct, dateLabel } from "../../ui";
import PerspectivePanel from "../../../perspective-panel";

export const dynamic = "force-dynamic";

const yoy = (cy, py) => (Number(py) ? Number(cy) / Number(py) - 1 : null);

// Heatmap cell: green→red by YoY %
function heat(v) {
  if (v === null || v === undefined) return { text: "—", bg: "transparent", fg: "var(--faint)" };
  const capped = Math.max(-0.5, Math.min(0.5, v));
  const alpha = Math.min(0.55, Math.abs(capped) * 1.4).toFixed(2);
  return {
    text: `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`,
    bg: v >= 0 ? `rgba(80,140,40,${alpha})` : `rgba(190,60,45,${alpha})`,
    fg: "var(--ink)",
  };
}
const HeatCell = ({ v }) => {
  const h = heat(v);
  return <span style={{ display: "inline-block", minWidth: 58, textAlign: "right", background: h.bg, color: h.fg, borderRadius: 5, padding: "1px 6px" }}>{h.text}</span>;
};

function derive(r) {
  const atv = Number(r.trans) ? Number(r.net) / Number(r.trans) : null;
  const pyAtv = Number(r.py_trans) ? Number(r.py_net) / Number(r.py_trans) : null;
  const conv = Number(r.footfall) ? Number(r.trans) / Number(r.footfall) : null;
  return {
    ...r, atv, conv,
    yoy_net: yoy(r.net, r.py_net),
    yoy_trans: yoy(r.trans, r.py_trans),
    yoy_ff: yoy(r.footfall, r.py_footfall),
    yoy_atv: atv !== null && pyAtv ? atv / pyAtv - 1 : null,
    vs_fc: Number(r.fc_net) ? Number(r.net) / Number(r.fc_net) - 1 : null,
  };
}

function AwaitingData({ crumb, title }) {
  return (
    <div className="fos-shell">
      <PageHeader crumb={crumb} title={title} />
      <SubNav items={STORE_SALES_NAV} active="" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "18px 20px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
        No store trading data has been loaded yet. Run the four store-data load files
        (foundation, 2025 actuals, 2026 actuals, forecast) against the database, then refresh this page.
      </div>
    </div>
  );
}

export default async function StoreLeague() {
  const session = await getSession();
  if (!session) redirect("/login");

  const wins = await getWindows();
  if (!wins) return <AwaitingData crumb="Trading" title="Store League" />;
  const [mtdRows, ytdRows, forecastOnly] = await Promise.all([getStoreLeague(wins.mtd), getStoreLeague(wins.ytd), getForecastOnlyStores(wins.ytd).catch(() => [])]);
  const mtdBy = Object.fromEntries(mtdRows.map((r) => [r.store_code, derive(r)]));
  const rows = ytdRows.map((r, i) => ({ rank: i + 1, ytd: derive(r), mtd: mtdBy[r.store_code] }));

  return (
    <div className="fos-shell">
      <PageHeader crumb="Trading" title="Store League — ranked by YTD net sales"
        right={`Data to ${dateLabel(wins.maxDate)}`} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="store-performance" pageName="Store Performance" />
      </div>
      <SubNav items={STORE_SALES_NAV} active="/finance-os/store-sales/league" />

      <Panel title={`All stores (${rows.length})`} note="YTD figures with month-to-date alongside; heatmaps vs same dates last year and vs the live forecast (Plan – Finance → Sales Forecast)">
        <Table columns={[
          { label: "#", align: "right", render: (r) => r.rank },
          { label: "Store", render: (r) => <a href={`/finance-os/store-sales/store?store=${encodeURIComponent(r.ytd.store_code)}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.ytd.store_name}</a> },
          { label: "Operator", render: (r) => r.ytd.operator_name },
          { label: "YTD net", align: "right", render: (r) => money(r.ytd.net) },
          { label: "YTD forecast", align: "right", render: (r) => (r.ytd.fc_net != null ? money(r.ytd.fc_net) : "—") },
          { label: "vs forecast", align: "right", render: (r) => <HeatCell v={r.ytd.vs_fc} /> },
          { label: "Margin", align: "right", render: (r) => (Number(r.ytd.net) && r.ytd.gm != null ? pct(Number(r.ytd.gm) / Number(r.ytd.net)) : "—") },
          { label: "ATV", align: "right", render: (r) => (r.ytd.atv === null ? "—" : `£${r.ytd.atv.toFixed(2)}`) },
          { label: "Conv", align: "right", render: (r) => (r.ytd.conv === null ? "—" : pct(r.ytd.conv)) },
          { label: "Sales YoY", align: "right", render: (r) => <HeatCell v={r.ytd.yoy_net} /> },
          { label: "Trans YoY", align: "right", render: (r) => <HeatCell v={r.ytd.yoy_trans} /> },
          { label: "Footfall YoY", align: "right", render: (r) => <HeatCell v={r.ytd.yoy_ff} /> },
          { label: "ATV YoY", align: "right", render: (r) => <HeatCell v={r.ytd.yoy_atv} /> },
          { label: "MTD net", align: "right", render: (r) => (r.mtd ? money(r.mtd.net) : "—") },
          { label: "MTD YoY", align: "right", render: (r) => <HeatCell v={r.mtd ? r.mtd.yoy_net : null} /> },
          { label: "MTD vs fc", align: "right", render: (r) => <HeatCell v={r.mtd ? r.mtd.vs_fc : null} /> },
        ]} rows={rows} />
      </Panel>
      {forecastOnly.length > 0 && (
        <Panel title={`Forecast, no sales yet (${forecastOnly.length})`} note="stores the live forecast expects sales from year to date that have traded nothing — not open yet, or named differently in the forecast from the store they trade as">
          <Table columns={[
            { label: "Store (as in the forecast)", render: (r) => r.store_name },
            { label: "Operator", render: (r) => r.operator_name },
            { label: "YTD forecast", align: "right", render: (r) => money(r.net) },
          ]} rows={forecastOnly} />
        </Panel>
      )}
      <div style={{ fontSize: 12, color: "var(--faint)" }}>
        Blank YoY cells mean the store wasn't trading in the comparison period last year. Company stores shown as Miniso UK.
      </div>
    </div>
  );
}
