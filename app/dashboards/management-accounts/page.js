import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getMaDashboard } from "../../../lib/ma-dashboard";
import { PageHeader, money } from "../../finance-os/ui";

export const dynamic = "force-dynamic";

const monthLabel = (m) => { const [y, mo] = m.split("-"); return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo]} ${y.slice(2)}`; };
const pct1 = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const gbp = (v) => (v == null ? "—" : money(v, { compact: true }));

// Management Accounts dashboard — actuals (PERFORM board packs) vs forecast
// (PLAN Forecast Builder), Revenue and EBITDA by scope and Group, current month
// or year to date. Internal management reporting.
export default async function MaDashboard({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const period = sp?.period === "ytd" ? "ytd" : "current";
  const d = await getMaDashboard({ period, year: sp?.year });

  const box = { fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Dashboards · Financial reporting" title="Management Accounts dashboard"
        right={d.loaded ? (period === "ytd" ? "Actual vs forecast · YTD" : "Actual vs forecast · current month") : "Awaiting data"} />

      {!d.ready ? (
        <div style={box}>Run migrations <span style={{ fontFamily: "var(--mono)" }}>018</span> and <span style={{ fontFamily: "var(--mono)" }}>023</span>, then load the board packs and a forecast.</div>
      ) : !d.loaded ? (
        <div style={box}>
          No board-pack actuals loaded yet — pull them under <strong>Perform → Management Accounts</strong> (Refresh from Joiin).
          {!d.forecastLoaded && <> The forecast is also empty — upload it under <strong>Plan → Forecast Builder</strong>.</>}
        </div>
      ) : (
        <>
          <Controls period={period} year={d.year} years={d.years} />

          {!d.forecastLoaded && (
            <div style={{ ...box, marginBottom: 16, color: "var(--amber, #b8860b)" }}>
              No forecast loaded — showing actuals only. Upload the forecast under <strong>Plan → Forecast Builder</strong> to see variances.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 22 }}>
            <KpiHero title="Group revenue" v={d.group.revenue} />
            <KpiHero title="Group EBITDA" v={d.group.ebitda} />
            <MarginHero title="EBITDA margin" m={d.group.margin} />
          </div>

          <ScopeTable scopes={d.scopes} group={d.group} />

          <Trend trend={d.trend} />

          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 16, maxWidth: "82ch", lineHeight: 1.6 }}>
            Actuals from the Perform board packs (Joiin); forecast from the Plan Forecast Builder. Group is the sum of
            Store, Head Office and Franchise on the same basis as the forecast — the consolidated board pack in Perform
            carries the intercompany wholesale elimination and remains the authoritative group P&L. Internal management
            reporting — review before any external use.
          </div>
        </>
      )}
    </div>
  );
}

function Controls({ period, year, years }) {
  const pill = (active) => ({ padding: "4px 12px", fontSize: 12.5, fontWeight: active ? 700 : 500, borderRadius: 20, border: "1px solid " + (active ? "var(--accent)" : "var(--line)"), background: active ? "var(--accent-bg, rgba(180,150,60,.12))" : "transparent", color: active ? "var(--ink)" : "var(--muted)", textDecoration: "none" });
  const href = (patch) => { const p = new URLSearchParams({ period, ...(year ? { year } : {}), ...patch }); return `?${p.toString()}`; };
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
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

function KpiHero({ title, v }) {
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{gbp(v.actual)}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Forecast {gbp(v.forecast)}</div>
      <div style={{ fontSize: 13, marginTop: 8 }}><VarChip v={v} /> <span style={{ color: "var(--faint)", fontSize: 11.5 }}>vs forecast</span></div>
    </div>
  );
}

function MarginHero({ title, m }) {
  const delta = m.actual != null && m.forecast != null ? m.actual - m.forecast : null;
  const c = delta == null ? "var(--faint)" : delta >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{pct1(m.actual)}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Forecast {pct1(m.forecast)}</div>
      <div style={{ fontSize: 13, marginTop: 8, color: c, fontWeight: 650 }}>
        {delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pts`}
        <span style={{ color: "var(--faint)", fontSize: 11.5, fontWeight: 400 }}> vs forecast</span>
      </div>
    </div>
  );
}

function ScopeTable({ scopes, group }) {
  const rows = [...scopes, group];
  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 700 : 400, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 22 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 760, width: "100%" }}>
        <thead>
          <tr>
            <th style={th(false)}>Scope</th>
            <th style={th(true)}>Revenue actual</th>
            <th style={th(true)}>Revenue fcst</th>
            <th style={th(true)}>Var</th>
            <th style={th(true)}>EBITDA actual</th>
            <th style={th(true)}>EBITDA fcst</th>
            <th style={th(true)}>Var</th>
            <th style={th(true)}>Margin</th>
          </tr>
        </thead>
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

function Trend({ trend }) {
  if (!trend?.length) return null;
  const max = Math.max(1, ...trend.flatMap((t) => [Math.abs(t.actual), Math.abs(t.forecast)]));
  const bar = (v, color) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, color }}>{gbp(v)}</div>
      <div style={{ flex: 1, height: 8, background: "var(--hairline)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${(Math.abs(v) / max) * 100}%`, height: "100%", background: color, opacity: 0.55 }} />
      </div>
    </div>
  );
  return (
    <div className="fos-card" style={{ padding: "16px 18px" }}>
      <div className="fos-eyebrow" style={{ margin: 0, marginBottom: 4 }}>Group EBITDA — actual vs forecast by month</div>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--faint)", marginBottom: 10 }}>
        <span><span style={{ color: "var(--accent)" }}>■</span> Actual</span>
        <span><span style={{ color: "var(--muted)" }}>■</span> Forecast</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", alignItems: "center" }}>
        {trend.map((t) => (
          <div key={t.ym} style={{ display: "contents" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>{monthLabel(t.ym)}</div>
            <div style={{ display: "grid", gap: 3 }}>
              {bar(t.actual, "var(--accent)")}
              {bar(t.forecast, "var(--muted)")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
