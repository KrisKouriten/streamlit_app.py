import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getMaDashboard } from "../../../lib/ma-dashboard";
import { getMaTabs } from "../../../lib/ma-tabs";
import { PageHeader, money } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

const monthLabel = (m) => { const [y, mo] = m.split("-"); return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo]} ${y.slice(2)}`; };
const pct1 = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const gbp = (v) => (v == null ? "—" : money(v, { compact: true }));

// The comparison bases the Overview can measure actuals against.
const BASES = [
  { key: "forecast", label: "Forecast", short: "fcst" },
  { key: "budget", label: "Budget", short: "budget" },
  { key: "priorYear", label: "Prior year", short: "PY" },
];
const basisOf = (k) => BASES.find((b) => b.key === k) || BASES[0];

const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "store-sales", label: "Store Sales" },
  { key: "store-labour", label: "Store Labour" },
  { key: "store-ebitda", label: "Store EBITDA" },
  { key: "ho-sales", label: "Head Office Sales" },
  { key: "warehouse-logistics", label: "Warehouse & Logistics" },
  { key: "marketing", label: "Marketing" },
  { key: "franchise-income", label: "Franchise Income" },
];

// Management Accounts Dashboard — actuals (per-entity Joiin P&L behind Perform →
// Management Accounts) vs forecast (Plan Forecast Builder). An Overview tab plus
// per-area analysis tabs. Current month or year to date. Internal reporting.
export default async function MaDashboard({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const period = sp?.period === "ytd" ? "ytd" : "current";
  const view = VIEWS.some((v) => v.key === sp?.view) ? sp.view : "overview";
  const compare = BASES.some((b) => b.key === sp?.compare) ? sp.compare : "forecast";
  const basis = basisOf(compare);

  const d = view === "overview"
    ? await getMaDashboard({ period, year: sp?.year, compare })
    : await getMaTabs({ period, year: sp?.year });

  const box = { fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Dashboards · Financial reporting" title="Management Accounts Dashboard"
        right={d.loaded ? `Actual vs ${basis.label.toLowerCase()} · ${period === "ytd" ? "YTD" : "current month"}` : "Awaiting data"} />

      <Controls view={view} period={period} year={d.year} years={d.years} compare={compare} budgetMeta={d.budgetMeta} />

      {!d.ready ? (
        <div style={box}>
          Run migrations <span style={{ fontFamily: "var(--mono)" }}>018</span> and <span style={{ fontFamily: "var(--mono)" }}>021</span>, then load the per-entity P&L (Perform) and a forecast (Plan).
          {d.diag && <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{d.diag}</div>}
        </div>
      ) : !d.loaded ? (
        <div style={box}>
          No actuals loaded yet — refresh the per-entity P&L under <strong>Perform → Management Accounts</strong>.
          {d.diag && <div style={{ marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{d.diag}</div>}
        </div>
      ) : view === "overview" ? (
        <Overview d={d} basis={basis} />
      ) : (
        <TabView tab={d.tabs[view]} forecastLoaded={d.forecastLoaded} />
      )}

      {d.loaded && (
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 16, maxWidth: "82ch", lineHeight: 1.6 }}>
          Actuals from the per-entity Joiin P&L behind Perform → Management Accounts; forecast from the Plan Forecast
          Builder. Figures are standalone by scope (before intercompany elimination) and EBITDA is on an operating basis,
          to match the forecast. Internal management reporting — review before any external use.
        </div>
      )}
    </div>
  );
}

function Controls({ view, period, year, years, compare, budgetMeta }) {
  const pill = (active) => ({ padding: "4px 12px", fontSize: 12.5, fontWeight: active ? 700 : 500, borderRadius: 20, border: "1px solid " + (active ? "var(--accent)" : "var(--line)"), background: active ? "var(--accent-bg, rgba(180,150,60,.12))" : "transparent", color: active ? "var(--ink)" : "var(--muted)", textDecoration: "none" });
  const tabBtn = (active) => ({ padding: "8px 14px", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "var(--ink)" : "var(--faint)", borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1, textDecoration: "none", whiteSpace: "nowrap" });
  const href = (patch) => { const p = new URLSearchParams({ view, period, compare, ...(year ? { year } : {}), ...patch }); return `?${p.toString()}`; };
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)", marginBottom: 14, flexWrap: "wrap", overflowX: "auto" }}>
        {VIEWS.map((v) => <Link key={v.key} href={href({ view: v.key })} style={tabBtn(v.key === view)}>{v.label}</Link>)}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="fos-eyebrow" style={{ margin: 0 }}>Period</span>
          <Link href={href({ period: "current" })} style={pill(period === "current")}>Current month</Link>
          <Link href={href({ period: "ytd" })} style={pill(period === "ytd")}>YTD</Link>
        </div>
        {years?.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="fos-eyebrow" style={{ margin: 0 }}>Year</span>
            {years.map((y) => <Link key={y} href={href({ year: y })} style={pill(y === year)}>{y}</Link>)}
          </div>
        )}
        {view === "overview" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="fos-eyebrow" style={{ margin: 0 }}>Compare vs</span>
            {BASES.map((b) => (
              <Link key={b.key} href={href({ compare: b.key })} style={pill(b.key === compare)}
                title={b.key === "budget" && !budgetMeta ? "No approved budget version yet — snapshot one under Finance Data → Budget Versions" : undefined}>
                {b.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      {view === "overview" && compare === "budget" && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>
          {budgetMeta
            ? <>Budget: <strong style={{ color: "var(--muted)" }}>{budgetMeta.label}</strong>{budgetMeta.status !== "APPROVED" ? ` (${budgetMeta.status.toLowerCase()})` : ""} · <Link href="/data/versions?kind=BUDGET" style={{ color: "var(--accent)" }}>manage versions</Link></>
            : <>No approved budget version yet — snapshot one under <Link href="/data/versions?kind=BUDGET" style={{ color: "var(--accent)" }}>Finance Data → Budget Versions</Link>.</>}
        </div>
      )}
    </div>
  );
}

function VarChip({ v }) {
  if (!v || v.delta == null) return <span style={{ color: "var(--faint)" }}>—</span>;
  const c = v.fav ? "var(--green)" : "var(--red)";
  const sign = v.delta >= 0 ? "+" : "−";
  return (
    <span style={{ color: c, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
      {sign}{gbp(Math.abs(v.delta))}{v.pct != null && <span style={{ fontWeight: 500, opacity: 0.8 }}> ({sign}{Math.abs(v.pct * 100).toFixed(1)}%)</span>}
    </span>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ d, basis }) {
  const missingBudget = basis.key === "budget" && !d.budgetLoaded;
  return (
    <>
      {basis.key === "forecast" && !d.forecastLoaded && (
        <div style={{ fontSize: 13, color: "var(--amber, #b8860b)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 16 }}>
          No forecast loaded — showing actuals only. Upload it under <strong>Plan → Forecast Builder</strong> for variances.
        </div>
      )}
      {missingBudget && (
        <div style={{ fontSize: 13, color: "var(--amber, #b8860b)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 16 }}>
          No approved budget version — showing actuals only. Snapshot one under <strong>Finance Data → Budget Versions</strong>.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 22 }}>
        <KpiHero title="Group revenue" v={d.group.revenue} basis={basis} />
        <KpiHero title="Group EBITDA" v={d.group.ebitda} basis={basis} />
        <MarginHero title="EBITDA margin" m={d.group.margin} basis={basis} />
      </div>
      <ScopeTable scopes={d.scopes} group={d.group} basis={basis} />
      <Trend trend={d.trend} basis={basis} />
    </>
  );
}

function KpiHero({ title, v, basis = BASES[0] }) {
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{gbp(v.actual)}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{basis.label} {gbp(v.forecast)}</div>
      <div style={{ fontSize: 13, marginTop: 8 }}><VarChip v={v} /> <span style={{ color: "var(--faint)", fontSize: 11.5 }}>vs {basis.label.toLowerCase()}</span></div>
    </div>
  );
}

function MarginHero({ title, m, basis = BASES[0] }) {
  const ref = m[basis.key];
  const delta = m.actual != null && ref != null ? m.actual - ref : null;
  const c = delta == null ? "var(--faint)" : delta >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{pct1(m.actual)}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{basis.label} {pct1(ref)}</div>
      <div style={{ fontSize: 13, marginTop: 8, color: c, fontWeight: 650 }}>
        {delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pts`}
        <span style={{ color: "var(--faint)", fontSize: 11.5, fontWeight: 400 }}> vs {basis.label.toLowerCase()}</span>
      </div>
    </div>
  );
}

function ScopeTable({ scopes, group, basis = BASES[0] }) {
  const rows = [...scopes, group];
  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 700 : 400, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 22 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 760, width: "100%" }}>
        <thead><tr>
          <th style={th(false)}>Scope</th><th style={th(true)}>Revenue actual</th><th style={th(true)}>Revenue {basis.short}</th><th style={th(true)}>Var</th>
          <th style={th(true)}>EBITDA actual</th><th style={th(true)}>EBITDA {basis.short}</th><th style={th(true)}>Var</th><th style={th(true)}>Margin</th>
        </tr></thead>
        <tbody>
          {rows.map((s, i) => {
            const isGroup = i === rows.length - 1;
            return (
              <tr key={s.label} style={isGroup ? { borderTop: "2px solid var(--line)" } : undefined}>
                <td style={td(false, isGroup)}>{s.label}</td>
                <td style={td(true, isGroup)}>{gbp(s.revenue.actual)}</td>
                <td style={{ ...td(true), color: "var(--muted)" }}>{gbp(s.revenue.forecast)}</td>
                <td style={td(true)}><VarChip v={s.revenue} /></td>
                <td style={td(true, isGroup)}>{gbp(s.ebitda.actual)}</td>
                <td style={{ ...td(true), color: "var(--muted)" }}>{gbp(s.ebitda.forecast)}</td>
                <td style={td(true)}><VarChip v={s.ebitda} /></td>
                <td style={{ ...td(true), color: "var(--muted)" }}>{pct1(s.margin.actual)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Trend({ trend, basis = BASES[0] }) {
  if (!trend?.length) return null;
  const refOf = (t) => t[basis.key];
  const max = Math.max(1, ...trend.flatMap((t) => [Math.abs(t.actual), Math.abs(refOf(t) || 0)]));
  const bar = (v, color) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, color }}>{gbp(v)}</div>
      <div style={{ flex: 1, height: 8, background: "var(--hairline)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${(Math.abs(v || 0) / max) * 100}%`, height: "100%", background: color, opacity: 0.55 }} />
      </div>
    </div>
  );
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0, marginBottom: 4 }}>Group EBITDA — actual vs {basis.label.toLowerCase()} by month</div>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--faint)", marginBottom: 10 }}>
        <span><span style={{ color: "var(--accent)" }}>■</span> Actual</span>
        <span><span style={{ color: "var(--muted)" }}>■</span> {basis.label}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", alignItems: "center" }}>
        {trend.map((t) => (
          <div key={t.ym} style={{ display: "contents" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>{monthLabel(t.ym)}</div>
            <div style={{ display: "grid", gap: 3 }}>{bar(t.actual, "var(--accent)")}{bar(refOf(t), "var(--muted)")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Analysis tabs ---------------- */
function TabView({ tab, forecastLoaded }) {
  if (!tab) return <div style={{ fontSize: 13, color: "var(--faint)" }}>No data for this view.</div>;
  return (
    <>
      {tab.blurb && <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 16px", maxWidth: "80ch", lineHeight: 1.55 }}>{tab.blurb}</p>}
      {!forecastLoaded && <div style={{ fontSize: 12.5, color: "var(--amber, #b8860b)", marginBottom: 14 }}>No forecast loaded — actuals only.</div>}
      {tab.kpis?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
          {tab.kpis.map((k, i) => <TabKpi key={i} k={k} />)}
        </div>
      )}
      {tab.graph && <LineChart g={tab.graph} />}
      {tab.table && <TabTable t={tab.table} />}
    </>
  );
}

function TabKpi({ k }) {
  if (k.isPct) {
    const delta = k.actual != null && k.forecast != null ? k.actual - k.forecast : null;
    const good = delta == null ? null : (k.favourHigh === false ? delta <= 0 : delta >= 0);
    const c = good == null ? "var(--faint)" : good ? "var(--green)" : "var(--red)";
    return (
      <div className="fos-card" style={{ padding: "16px 18px" }}>
        <div className="fos-eyebrow" style={{ margin: 0 }}>{k.label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{pct1(k.actual)}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Forecast {pct1(k.forecast)}</div>
        <div style={{ fontSize: 13, marginTop: 8, color: c, fontWeight: 650 }}>{delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pts`}<span style={{ color: "var(--faint)", fontSize: 11.5, fontWeight: 400 }}> vs forecast</span></div>
      </div>
    );
  }
  return <KpiHero title={k.label} v={k} />;
}

function TabTable({ t }) {
  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "8px 12px", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 700 : 400, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
  const cell = (c, ci, strong) => {
    if (c == null) return <td key={ci} style={td(ci > 0)}>—</td>;
    if (typeof c === "string") return <td key={ci} style={td(false, strong)}>{c}</td>;
    if (typeof c === "object" && "delta" in c) return <td key={ci} style={td(true)}><VarChip v={c} /></td>;
    if (typeof c === "number") return <td key={ci} style={td(true, strong)}>{ci === t.pctCol ? pct1(c) : gbp(c)}</td>;
    return <td key={ci} style={td(true)}>{String(c)}</td>;
  };
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginTop: 4 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 620, width: "100%" }}>
        <thead><tr>{t.cols.map((c, i) => <th key={i} style={th(i > 0)}>{c}</th>)}</tr></thead>
        <tbody>
          {t.rows.map((r, i) => <tr key={i}>{r.cells.map((c, ci) => cell(c, ci, false))}</tr>)}
          {t.totalRow && <tr style={{ borderTop: "2px solid var(--line)" }}>{t.totalRow.cells.map((c, ci) => cell(c, ci, true))}</tr>}
        </tbody>
      </table>
    </div>
  );
}

// Two-line SVG chart: full-year forecast + YTD actual (actual is null past YTD).
function LineChart({ g }) {
  const W = 720, H = 240, pad = { l: 8, r: 8, t: 16, b: 24 };
  const n = g.months.length;
  if (!n) return null;
  const vals = [...g.forecast, ...g.actual].filter((v) => v != null);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, n - 1);
  const y = (v) => H - pad.b - ((v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const path = (arr) => {
    let dParts = [], started = false;
    arr.forEach((v, i) => { if (v == null) { started = false; return; } dParts.push(`${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`); started = true; });
    return dParts.join(" ");
  };
  const zeroY = y(0);
  return (
    <div className="fos-card" style={{ padding: "16px 18px", marginBottom: 16 }}>
      <div className="fos-eyebrow" style={{ margin: 0, marginBottom: 4 }}>{g.label}</div>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--faint)", marginBottom: 8 }}>
        <span><span style={{ color: "var(--accent)" }}>■</span> Actual (YTD)</span>
        <span><span style={{ color: "var(--muted)" }}>■</span> Forecast (12m)</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, height: "auto", display: "block" }} preserveAspectRatio="none">
          {min < 0 && <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />}
          <path d={path(g.forecast)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
          <path d={path(g.actual)} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {g.months.map((m, i) => <text key={m} x={x(i)} y={H - 6} fontSize="9" fontFamily="var(--mono)" fill="var(--faint)" textAnchor="middle">{monthLabel(m).split(" ")[0]}</text>)}
        </svg>
      </div>
    </div>
  );
}
