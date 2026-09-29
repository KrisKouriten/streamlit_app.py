import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getWindows, getPeriodSummary, getFyPlanTotal, getMarketAssumptions, getMonthlyVsForecast, getForecastOnlyStores } from "../../../lib/store-sales";
import { PageHeader, Panel, Table, SubNav, STORE_SALES_NAV, money, pct, dateLabel, varianceTone } from "../ui";

export const dynamic = "force-dynamic";

const yoy = (cy, py) => (Number(py) ? Number(cy) / Number(py) - 1 : null);
const pctOrDash = (v, dp = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);

function kpiRows(s, side) {
  // side: 'co' | 'fr' — returns the five LFL KPI YoY figures for that operator side
  const g = (k) => Number(s[`lfl_${k}_${side}`]);
  const atvCy = g("trans") ? g("net") / g("trans") : null;
  const atvPy = Number(s[`lfl_py_trans_${side}`]) ? Number(s[`lfl_py_net_${side}`]) / Number(s[`lfl_py_trans_${side}`]) : null;
  const convCy = g("ff") ? g("trans") / g("ff") : null;
  const convPy = Number(s[`lfl_py_ff_${side}`]) ? Number(s[`lfl_py_trans_${side}`]) / Number(s[`lfl_py_ff_${side}`]) : null;
  return {
    net: yoy(s[`lfl_net_${side}`], s[`lfl_py_net_${side}`]),
    trans: yoy(s[`lfl_trans_${side}`], s[`lfl_py_trans_${side}`]),
    atv: atvCy !== null && atvPy ? atvCy / atvPy - 1 : null,
    footfall: yoy(s[`lfl_ff_${side}`], s[`lfl_py_ff_${side}`]),
    conv: convCy !== null && convPy ? convCy / convPy - 1 : null,
  };
}

function PeriodBlock({ title, range, s, fyPlan, mkt }) {
  const marginPct = Number(s.net) ? Number(s.gm) / Number(s.net) : null;
  const lflYoY = yoy(s.lfl_net, s.lfl_py_net);
  const vsFc = Number(s.forecast) ? Number(s.net) / Number(s.forecast) - 1 : null;
  const co = kpiRows(s, "co"), fr = kpiRows(s, "fr");
  const cpi = mkt.CPI_MTD?.value ?? 0, market = mkt.RSI_YOY?.value ?? 0;
  const fcGap = Number(s.net) - Number(s.forecast || 0);
  const tiles = [
    ["Net sales", money(s.net, { compact: true }), null],
    ["Forecast", Number(s.forecast) ? money(s.forecast, { compact: true }) : "—", null],
    ["vs forecast", pctOrDash(vsFc), vsFc, Number(s.forecast) ? `${fcGap >= 0 ? "+" : "−"}${money(Math.abs(fcGap), { compact: true })}` : null],
    ["Margin %", marginPct === null ? "—" : pct(marginPct), null],
    ["Margin £", money(s.gm, { compact: true }), null],
    ["LFL vs last year", pctOrDash(lflYoY), lflYoY],
    ["% of FY plan", fyPlan ? pct(Number(s.net) / fyPlan) : "—", null],
  ];
  const KPI_LABELS = [["net", "Net sales"], ["trans", "Transactions"], ["atv", "ATV (spend/txn)"], ["footfall", "Footfall"], ["conv", "Conversion"]];
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{title}</div>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>{range}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
        {tiles.map(([label, value, tone, sub]) => (
          <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1, color: tone === null || tone === undefined ? "var(--ink)" : tone >= 0 ? "var(--green)" : "var(--red)" }}>{value}</div>
            {sub && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 5 }}>{sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>BY OPERATOR</div>
          <Table columns={[
            { label: "", render: (r) => r.name },
            { label: "Net sales", align: "right", render: (r) => money(r.net) },
            { label: "Share", align: "right", render: (r) => pct(r.share) },
            { label: "Forecast", align: "right", render: (r) => (Number(r.fc) ? money(r.fc) : "—") },
            { label: "vs forecast", align: "right", tone: (r) => varianceTone(r.vsplan), render: (r) => pctOrDash(r.vsplan) },
            { label: "LFL vs LY", align: "right", tone: (r) => varianceTone(r.yoy), render: (r) => pctOrDash(r.yoy) },
          ]} rows={[
            { name: "Miniso UK (company)", net: s.net_company, share: Number(s.net) ? s.net_company / s.net : null, fc: s.fc_company,
              yoy: yoy(s.lfl_net_co, s.lfl_py_net_co), vsplan: Number(s.fc_company) ? s.net_company / s.fc_company - 1 : null },
            { name: "Franchise partners", net: s.net_franchise, share: Number(s.net) ? s.net_franchise / s.net : null, fc: s.fc_franchise,
              yoy: yoy(s.lfl_net_fr, s.lfl_py_net_fr), vsplan: Number(s.fc_franchise) ? s.net_franchise / s.fc_franchise - 1 : null },
            { name: "Total", net: s.net, share: Number(s.net) ? 1 : null, fc: s.forecast,
              yoy: lflYoY, vsplan: vsFc },
          ]} />
          <div style={{ fontSize: 12, color: "var(--faint)", margin: "14px 0 6px" }}>COMPARABLE STORES</div>
          <Table columns={[
            { label: "", render: (r) => r.name },
            { label: "Net sales", align: "right", render: (r) => money(r.net) },
            { label: "Stores", align: "right", render: (r) => r.n },
            { label: "vs LY", align: "right", tone: (r) => varianceTone(r.yoy), render: (r) => pctOrDash(r.yoy) },
          ]} rows={[
            { name: "Established · full-yr '25", net: s.est_net, n: s.est_stores, yoy: yoy(s.est_net, s.est_py_net) },
            { name: "Like-for-like · 4wk+", net: s.lfl_net, n: s.lfl_stores, yoy: lflYoY },
          ]} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>LFL KPI PERFORMANCE · comparable stores, YoY</div>
          <Table columns={[
            { label: "KPI (LFL)", render: (r) => r.kpi },
            { label: "Miniso UK", align: "right", tone: (r) => varianceTone(r.co), render: (r) => pctOrDash(r.co) },
            { label: "Franchise", align: "right", tone: (r) => varianceTone(r.fr), render: (r) => pctOrDash(r.fr) },
          ]} rows={KPI_LABELS.map(([k, label]) => ({ kpi: label, co: co[k], fr: fr[k] }))} />
          <div style={{ fontSize: 12, color: "var(--faint)", margin: "14px 0 6px" }}>LFL vs INFLATION & MARKET</div>
          <Table columns={[
            { label: "", render: (r) => r.name },
            { label: "LFL", align: "right", tone: (r) => varianceTone(r.lfl), render: (r) => pctOrDash(r.lfl) },
            { label: "Real (−CPI)", align: "right", tone: (r) => varianceTone(r.real), render: (r) => pctOrDash(r.real) },
            { label: "vs market", align: "right", tone: (r) => varianceTone(r.vsm), render: (r) => pctOrDash(r.vsm) },
          ]} rows={[
            { name: "Miniso UK", lfl: co.net, real: co.net === null ? null : co.net - cpi, vsm: co.net === null ? null : co.net - market },
            { name: "Franchise", lfl: fr.net, real: fr.net === null ? null : fr.net - cpi, vsm: fr.net === null ? null : fr.net - market },
            { name: "Total (LFL)", lfl: lflYoY, real: lflYoY === null ? null : lflYoY - cpi, vsm: lflYoY === null ? null : lflYoY - market },
          ]} />
        </div>
      </div>
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/*
 * Actual against the live forecast (Plan – Finance → Sales Forecast), month by
 * month for the year, company and franchise — the same consolidated view the
 * Sales Forecast page shows, with the actuals laid against it. Months with no
 * trading yet show forecast only; the variance is actual − forecast for the
 * months that have traded.
 */
function MonthlyVsForecast({ year, months, forecastOnly }) {
  const dash = <span style={{ color: "var(--faint)" }}>—</span>;
  const traded = months.filter((m) => m.hasActual);
  const sum = (arr, f) => arr.reduce((t, m) => t + f(m), 0);
  const tot = {
    ym: "FY", hasActual: traded.length > 0,
    actual: { company: sum(traded, (m) => m.actual.company), franchise: sum(traded, (m) => m.actual.franchise), total: sum(traded, (m) => m.actual.total) },
    forecast: { company: sum(months, (m) => m.forecast.company), franchise: sum(months, (m) => m.forecast.franchise), total: sum(months, (m) => m.forecast.total) },
    fcToDate: sum(traded, (m) => m.forecast.total),
  };
  const row = (m, isTotal = false) => {
    const fcCompare = isTotal ? tot.fcToDate : m.forecast.total;
    const v = m.hasActual ? m.actual.total - fcCompare : null;
    const vp = m.hasActual && fcCompare ? m.actual.total / fcCompare - 1 : null;
    return { ...m, label: isTotal ? `FY ${year}${traded.length ? ` · actual ${traded.length} month${traded.length === 1 ? "" : "s"}` : ""}` : ymLabel(m.ym), v, vp, isTotal };
  };
  const rows = [...months.map((m) => row(m)), row(tot, true)];
  const b = (r, x) => (r.isTotal ? <strong>{x}</strong> : x);
  return (
    <Panel title={`Actual vs forecast by month — ${year}`}
      note="live forecast from Plan – Finance → Sales Forecast · variance is actual − forecast for months that have traded (the FY row compares actual to date with the forecast for the same months)">
      <div style={{ textAlign: "right", margin: "-4px 0 8px" }}>
        <a href="/plan/sales-forecast" style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>Sales Forecast →</a>
      </div>
      <Table columns={[
        { label: "Month", render: (r) => b(r, r.label) },
        { label: "Actual · company", align: "right", render: (r) => (r.hasActual ? b(r, money(r.actual.company)) : dash) },
        { label: "Actual · franchise", align: "right", render: (r) => (r.hasActual ? b(r, money(r.actual.franchise)) : dash) },
        { label: "Actual", align: "right", render: (r) => (r.hasActual ? b(r, money(r.actual.total)) : dash) },
        { label: "Forecast · company", align: "right", render: (r) => b(r, money(r.forecast.company)) },
        { label: "Forecast · franchise", align: "right", render: (r) => b(r, money(r.forecast.franchise)) },
        { label: "Forecast", align: "right", render: (r) => b(r, money(r.forecast.total)) },
        { label: "Variance £", align: "right", tone: (r) => varianceTone(r.v), render: (r) => (r.v == null ? dash : b(r, `${r.v >= 0 ? "+" : "−"}${money(Math.abs(r.v))}`)) },
        { label: "Variance %", align: "right", tone: (r) => varianceTone(r.vp), render: (r) => (r.vp == null ? dash : b(r, pctOrDash(r.vp))) },
      ]} rows={rows} />
      {forecastOnly.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 10, lineHeight: 1.55 }}>
          {forecastOnly.length} store{forecastOnly.length === 1 ? " has" : "s have"} forecast sales year to date but no actual sales: {forecastOnly.slice(0, 8).map((f) => `${f.store_name} (${money(f.net, { compact: true })})`).join(", ")}{forecastOnly.length > 8 ? ", …" : ""}.
          {" "}Either not open yet, or the name in the forecast doesn&rsquo;t match the store it trades as — check on <a href="/plan/sales-forecast" style={{ color: "var(--accent)" }}>Sales Forecast</a>.
        </div>
      )}
    </Panel>
  );
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

export default async function StoreSalesExecutive() {
  const session = await getSession();
  if (!session) redirect("/login");

  const wins = await getWindows();
  if (!wins) return <AwaitingData crumb="Trading" title="Store Sales & KPI — All Stores" />;
  const year = Number(String(wins.ytd.fromDate).slice(0, 4));
  const [week, mtd, ytd, fyPlan, mkt, byMonth, forecastOnly] = await Promise.all([
    getPeriodSummary(wins.week), getPeriodSummary(wins.mtd), getPeriodSummary(wins.ytd),
    getFyPlanTotal(year), getMarketAssumptions(),
    getMonthlyVsForecast(year).catch(() => []), getForecastOnlyStores(wins.ytd).catch(() => []),
  ]);
  const fmt = (w) => `${new Date(w.fromDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(w.toDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="fos-shell">
      <PageHeader crumb="Trading" title="Store Sales & KPI — All Stores"
        right={`Data to ${dateLabel(wins.maxDate)}`} />
      <SubNav items={STORE_SALES_NAV} active="/finance-os/store-sales" />

      <PeriodBlock title="This week" range={fmt(wins.week)} s={week} fyPlan={fyPlan} mkt={mkt} />
      <PeriodBlock title="Month to date" range={fmt(wins.mtd)} s={mtd} fyPlan={fyPlan} mkt={mkt} />
      <PeriodBlock title="Year to date" range={fmt(wins.ytd)} s={ytd} fyPlan={fyPlan} mkt={mkt} />

      {byMonth.length > 0 && <MonthlyVsForecast year={year} months={byMonth} forecastOnly={forecastOnly} />}

      <Panel title="Definitions" note="governed — one calculation everywhere">
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 16px" }}>
          Only rows passing the model's validity check are counted. Prior year = same calendar dates − 365 days.
          Like-for-like = stores trading in both periods with 4+ weeks' history. Established = traded all of 2025 and still trading.
          ATV = net sales ÷ net transactions. Conversion = net transactions ÷ footfall.
          CPI {pct(mkt.CPI_MTD?.value ?? 0)} and market {pct(mkt.RSI_YOY?.value ?? 0)} from {mkt.CPI_MTD?.source || "ONS"}/{mkt.RSI_YOY?.source || "ONS"} ({mkt.RSI_YOY?.period_label || ""}).
          Forecast and FY plan {money(fyPlan, { compact: true })} = the live version on Plan – Finance → Sales Forecast, every company and franchise store, for the year being viewed.
        </div>
      </Panel>
    </div>
  );
}
