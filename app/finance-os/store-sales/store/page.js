import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { getWindows, getStoreList, getStoreDetail, getMarketAssumptions } from "../../../../lib/store-sales";
import { PageHeader, Panel, Table, SubNav, STORE_SALES_NAV, money, pct, dateLabel, varianceTone } from "../../ui";

export const dynamic = "force-dynamic";

const yoy = (cy, py) => (Number(py) ? Number(cy) / Number(py) - 1 : null);
const pctOrDash = (v, dp = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic, rule-based watch-outs — same spirit as the Excel's auto priorities.
function autoPriorities(k) {
  const notes = [];
  if (k.yoyNet !== null && k.yoyNet < -0.1) notes.push(`Net sales down ${(k.yoyNet * 100).toFixed(1)}% vs last year — biggest headline risk.`);
  if (k.yoyFf !== null && k.yoyFf < -0.1) notes.push(`Footfall down ${(k.yoyFf * 100).toFixed(1)}% — traffic, location or opening-hours issue rather than in-store execution.`);
  if (k.yoyConv !== null && k.yoyConv < -0.05) notes.push(`Conversion down ${(k.yoyConv * 100).toFixed(1)}% — shoppers entering but not buying; check availability, ranging and service.`);
  if (k.yoyAtv !== null && k.yoyAtv > 0.05) notes.push(`ATV up ${(k.yoyAtv * 100).toFixed(1)}% — price/mix is cushioning volume; volume recovery is the lever.`);
  if (k.yoyReturns !== null && k.yoyReturns > 0.25) notes.push(`Returns value up ${(k.yoyReturns * 100).toFixed(1)}% vs last year — quality or refund-policy watch-out.`);
  if (k.beStatus === "BELOW") notes.push(`Trading below break-even year-to-date — see the Break-even board for the cost profile.`);
  if (!notes.length) notes.push("No red flags on the standard checks — sales, traffic, conversion and returns all within tolerance.");
  return notes;
}

function AwaitingData({ crumb, title }) {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb={crumb} title={title} />
      <SubNav items={STORE_SALES_NAV} active="" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "18px 20px", fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
        No store trading data has been loaded yet. Run the four store-data load files
        (foundation, 2025 actuals, 2026 actuals, forecast) against the database, then refresh this page.
      </div>
    </div>
  );
}

export default async function StoreDrilldown({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const [wins, stores, mkt] = await Promise.all([getWindows(), getStoreList(), getMarketAssumptions()]);
  if (!wins || !stores.length) return <AwaitingData crumb="Trading" title="Store drilldown" />;
  const code = params?.store && stores.some((s) => s.store_code === params.store) ? params.store : stores[0]?.store_code;
  const store = stores.find((s) => s.store_code === code);
  const d = await getStoreDetail(code, wins.ytd);
  const cy = d.cy || {}, py = d.py || {};

  const atvCy = Number(cy.trans) ? Number(cy.net) / Number(cy.trans) : null;
  const atvPy = Number(py.trans) ? Number(py.net) / Number(py.trans) : null;
  const convCy = Number(cy.footfall) ? Number(cy.trans) / Number(cy.footfall) : null;
  const convPy = Number(py.footfall) ? Number(py.trans) / Number(py.footfall) : null;
  const k = {
    yoyNet: yoy(cy.net, py.net),
    yoyFf: yoy(cy.footfall, py.footfall),
    yoyAtv: atvCy !== null && atvPy ? atvCy / atvPy - 1 : null,
    yoyConv: convCy !== null && convPy ? convCy / convPy - 1 : null,
    yoyReturns: yoy(cy.returns, py.returns),
    beStatus: d.profile?.ytd_status || null,
  };
  const cpi = mkt.CPI_YTD?.value ?? 0, market = mkt.RSI_YOY?.value ?? 0;
  const marginPct = Number(cy.net) && cy.gm != null ? Number(cy.gm) / Number(cy.net) : null;

  // monthly trend: net sales by month for 2025 & 2026
  const trend = MONTHS.map((m, i) => ({
    m,
    y25: Number(d.monthly.find((r) => r.yr === 2025 && r.mn === i + 1)?.net || 0),
    y26: Number(d.monthly.find((r) => r.yr === 2026 && r.mn === i + 1)?.net || 0),
  }));
  const maxBar = Math.max(1, ...trend.flatMap((t) => [t.y25, t.y26]));

  const detailRows = [
    ["Net sales", money(cy.net), money(py.net), yoy(cy.net, py.net)],
    ["Gross sales", money(cy.gross), money(py.gross), yoy(cy.gross, py.gross)],
    ["Gross margin £", cy.gm != null ? money(cy.gm) : "—", py.gm != null ? money(py.gm) : "—", cy.gm != null && py.gm ? yoy(cy.gm, py.gm) : null],
    ["Net units", money(cy.units).replace("£", ""), money(py.units).replace("£", ""), yoy(cy.units, py.units)],
    ["Net transactions", money(cy.trans).replace("£", ""), money(py.trans).replace("£", ""), yoy(cy.trans, py.trans)],
    ["Footfall in", money(cy.footfall).replace("£", ""), money(py.footfall).replace("£", ""), yoy(cy.footfall, py.footfall)],
    ["Returns value", money(cy.returns), money(py.returns), yoy(cy.returns, py.returns)],
    ["ATV", atvCy === null ? "—" : `£${atvCy.toFixed(2)}`, atvPy === null ? "—" : `£${atvPy.toFixed(2)}`, k.yoyAtv],
    ["Conversion", convCy === null ? "—" : pct(convCy), convPy === null ? "—" : pct(convPy), k.yoyConv],
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Trading" title={`Store drilldown — ${store?.store_name || code}`}
        right={`YTD to ${dateLabel(wins.maxDate)}`} />
      <SubNav items={STORE_SALES_NAV} active="/finance-os/store-sales/store" />

      <form method="get" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: "var(--muted)" }}>Select store:</label>
        <select name="store" defaultValue={code}
          style={{ height: 36, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontSize: 14 }}>
          {stores.map((s) => <option key={s.store_code} value={s.store_code}>{s.store_name} · {s.operator_name}</option>)}
        </select>
        <button type="submit" style={{ height: 36, padding: "0 16px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13.5 }}>View</button>
        <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{store?.operator_name} · trading since {dateLabel(store?.first_trading_date)}</span>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 24 }}>
        {[["Net sales (YTD)", money(cy.net, { compact: true }), k.yoyNet],
          ["Gross margin %", marginPct === null ? "—" : pct(marginPct), null],
          ["ATV", atvCy === null ? "—" : `£${atvCy.toFixed(2)}`, k.yoyAtv],
          ["Conversion", convCy === null ? "—" : pct(convCy), k.yoyConv],
          ["Footfall", money(cy.footfall).replace("£", ""), k.yoyFf]].map(([label, value, t]) => (
          <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1 }}>{value}</div>
            {t !== null && t !== undefined && <div style={{ fontSize: 11.5, marginTop: 4, color: t >= 0 ? "var(--green)" : "var(--red)" }}>{pctOrDash(t)} YoY</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, marginBottom: 24 }}>
        <Panel title="Monthly net sales" note="2026 vs 2025">
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
              {trend.map((t) => (
                <div key={t.m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 105, width: "100%", justifyContent: "center" }}>
                    <div title={`2025 ${t.m}: ${money(t.y25)}`} style={{ width: "38%", height: `${(t.y25 / maxBar) * 100}%`, background: "var(--line-strong)", borderRadius: "3px 3px 0 0" }} />
                    <div title={`2026 ${t.m}: ${money(t.y26)}`} style={{ width: "38%", height: `${(t.y26 / maxBar) * 100}%`, background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />
                  </div>
                  <div style={{ fontSize: 9.5, color: "var(--faint)" }}>{t.m}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>
              <span style={{ display: "inline-block", width: 9, height: 9, background: "var(--line-strong)", borderRadius: 2, marginRight: 4 }} />2025
              <span style={{ display: "inline-block", width: 9, height: 9, background: "var(--accent)", borderRadius: 2, margin: "0 4px 0 12px" }} />2026
            </div>
          </div>
        </Panel>
        <Panel title="True sales variance" note="strips inflation and the market">
          <Table columns={[
            { label: "", render: (r) => r.name },
            { label: "", align: "right", tone: (r) => (r.tone ? varianceTone(r.v) : undefined), render: (r) => pctOrDash(r.v) },
          ]} rows={[
            { name: "Nominal net sales YoY", v: k.yoyNet, tone: true },
            { name: "less: CPI inflation", v: cpi },
            { name: "= Real growth (volume)", v: k.yoyNet === null ? null : k.yoyNet - cpi, tone: true },
            { name: "less: UK retail market", v: market },
            { name: "= True variance vs market", v: k.yoyNet === null ? null : k.yoyNet - cpi - market, tone: true },
          ]} />
          {d.profile && (
            <div style={{ marginTop: 10, fontSize: 13, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
              Break-even (YTD): {money(d.profile.ytd_break_even)} vs actual {money(d.profile.ytd_actual)} —{" "}
              <strong style={{ color: d.profile.ytd_status === "ABOVE" ? "var(--green)" : "var(--red)" }}>{d.profile.ytd_status}</strong>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Store KPI detail" note="YTD 2026 vs same dates 2025">
        <Table columns={[
          { label: "Metric", render: (r) => r[0] },
          { label: "2026", align: "right", render: (r) => r[1] },
          { label: "2025", align: "right", render: (r) => r[2] },
          { label: "YoY", align: "right", tone: (r) => (r[3] === null ? "muted" : varianceTone(r[3])), render: (r) => pctOrDash(r[3]) },
        ]} rows={detailRows} />
      </Panel>

      <Panel title="Store priorities" note="rule-based checks on the standard KPI set — not a substitute for judgement">
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 16px" }}>
          {autoPriorities(k).map((t, i) => (
            <div key={i} style={{ fontSize: 13.5, color: "var(--ink)", padding: "4px 0", lineHeight: 1.55 }}>• {t}</div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
