"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, num, pct, StatRow, Stat, Badge } from "../../finance-os/ui";

/*
 * Company Store Performance — client shell. Two views (Executive summary / Stores),
 * a store selector, and the nine per-store sections. All data is pre-computed
 * server-side and passed in; this only renders + navigates.
 */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const th = { textAlign: "left", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right" };
const faint = { fontSize: 13, color: "var(--faint)" };
const mLabel = (yr, mn) => new Date(Date.UTC(yr, mn - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
const dLabel = (d) => { if (!d) return "—"; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const yoy = (cy, py) => (py ? (cy - py) / py : null);
const vTone = (v) => (v == null ? undefined : v < 0 ? "var(--red)" : "var(--green)");

export default function StorePerformanceUI({ view, exec, sku, stores = [], selectedStore, storeData, period = "YTD", periodLabel = "Year to date", months = [] }) {
  const router = useRouter();
  const nav = ({ v = view, store = selectedStore, per = period } = {}) => {
    const p = new URLSearchParams();
    p.set("view", v); if (store) p.set("store", store); if (per && per !== "YTD") p.set("period", per);
    router.push(`/dashboards/company-store-performance?${p.toString()}`);
  };
  const selStyle = { fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
  return (
    <div>
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 4, paddingLeft: 14, paddingRight: 14 }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", borderRadius: 9 }}>
          {[["exec", "Executive summary"], ["stores", "Stores"]].map(([k, l]) => {
            const on = k === view;
            return <button key={k} onClick={() => nav({ v: k })} style={{ fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 14px", borderRadius: 7, cursor: "pointer", background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`, color: on ? "var(--ink)" : "var(--muted)" }}>{l}</button>;
          })}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--faint)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".07em" }}>Period</span>
          <select value={period} onChange={(e) => nav({ per: e.target.value })} style={selStyle}>
            <option value="YTD">Year to date</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        {view === "stores" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: 11.5, color: "var(--faint)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".07em" }}>Focus store</span>
            <select value={selectedStore || ""} onChange={(e) => nav({ v: "stores", store: e.target.value })} style={{ ...selStyle, minWidth: 220 }}>
              <option value="">Select a store…</option>
              {stores.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {view === "exec" ? <Executive exec={exec} sku={sku} onFocus={(code) => nav({ v: "stores", store: code })} /> : <Stores storeData={storeData} sku={sku} periodLabel={periodLabel} />}
    </div>
  );
}

function Executive({ exec, sku, onFocus }) {
  const maxNet = Math.max(1, ...(exec.league || []).map((r) => Number(r.net) || 0));
  return (
    <div>
      <StatRow>
        <Stat label="Own-store revenue" value={exec.pnlLoaded ? money(exec.revenue, { compact: true }) : "—"} sub={exec.year ? `consolidated · ${exec.year}` : "P&L not loaded"} />
        <Stat label="Gross profit" value={exec.pnlLoaded ? money(exec.grossProfit, { compact: true }) : "—"} sub={exec.grossProfit != null && exec.revenue ? `${pct(exec.grossProfit / exec.revenue)} margin` : "—"} />
        <Stat label={exec.profitLabel} value={exec.pnlLoaded ? money(exec.profit, { compact: true }) : "—"} tone={exec.profit != null ? (exec.profit >= 0 ? "green" : "red") : undefined} sub={exec.profit != null && exec.revenue ? `${pct(exec.profit / exec.revenue)} of revenue` : "—"} />
        <Stat label="Stores trading" value={num(exec.storeCount)} sub="own-store estate" />
      </StatRow>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Store trading league</div>
        <div style={{ ...faint, marginBottom: 12 }}>Net sales · {exec.periodLabel || "year to date"}. Select a store to drill in.</div>
        {!exec.league?.length ? <div style={faint}>Store trading feed not loaded in this environment yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
              <thead><tr>{["Store", "Net sales", "", "GM %", "Transactions", "YoY net", ""].map((h, i) => <th key={i} style={{ ...th, textAlign: i === 1 || i === 3 || i === 4 || i === 5 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {exec.league.map((r) => {
                  const v = r.py_net ? (r.net - r.py_net) / r.py_net : null;
                  return (
                    <tr key={r.store_code || r.store_name}>
                      <td style={td}>{r.store_name}</td>
                      <td style={tdR}>{money(r.net, { compact: true })}</td>
                      <td style={td}><span style={{ display: "inline-block", width: 90, height: 7, background: "var(--raise)", borderRadius: 4, overflow: "hidden", verticalAlign: "middle" }}><span style={{ display: "block", width: `${Math.max(0, Math.min(100, (Number(r.net) / maxNet) * 100))}%`, height: "100%", background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))" }} /></span></td>
                      <td style={tdR}>{r.net ? pct((Number(r.gm) || 0) / Number(r.net)) : "—"}</td>
                      <td style={tdR}>{num(r.trans)}</td>
                      <td style={{ ...tdR, color: vTone(v) }}>{v == null ? "—" : pct(v)}</td>
                      <td style={tdR}>{r.store_code ? <button onClick={() => onFocus(r.store_code)} style={{ fontSize: 11.5, color: "var(--accent)", background: "transparent", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Focus →</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {exec.breakEven?.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Break-even</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead><tr>{["Store", "YTD actual", "Break-even", "Headroom"].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {exec.breakEven.map((r) => { const hr = (Number(r.ytd_actual) || 0) - (Number(r.ytd_break_even) || 0); return (
                  <tr key={r.store_code}><td style={td}>{r.store_name}</td><td style={tdR}>{money(r.ytd_actual, { compact: true })}</td><td style={tdR}>{money(r.ytd_break_even, { compact: true })}</td><td style={{ ...tdR, color: vTone(hr) }}>{money(hr, { compact: true })}</td></tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize: 13.5, fontWeight: 650, margin: "6px 2px 10px" }}>Range SKU summaries</div>
      <SkuSections sku={sku} />
    </div>
  );
}

function Stores({ storeData, sku, periodLabel = "Year to date" }) {
  if (!storeData) {
    return <div style={card}><div style={faint}>Select a store above to see its sales, forecast, financial summary, KPIs, allocations, stock on hand and the range SKU summaries.</div></div>;
  }
  const d = storeData, k = d.kpis || {};
  const cy = d.cy || {}, py = d.py || {};
  const gmPct = k.gmPct;
  const ytdNet = d.ytdNet || 0;
  const fcVar = d.forecastSales != null ? ytdNet - d.forecastSales : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{d.storeName}</div>
        {d.operator && <Badge tone="muted">{d.operator}</Badge>}
      </div>

      {/* 1 · Sales results */}
      <Section title="Sales results" note={`${periodLabel} vs prior year`}>
        {!d.cy ? <Empty>No store sales for this store in the current window.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
            <thead><tr>{["Measure", "This year", "Last year", "YoY"].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {[["Net sales", "net"], ["Gross sales", "gross"], ["Gross margin", "gm"], ["Units", "units", true], ["Transactions", "trans", true], ["Returns", "returns"]].map(([label, key, isNum]) => {
                const c = Number(cy[key]) || 0, p = Number(py[key]) || 0, v = yoy(c, p);
                return <tr key={key}><td style={td}>{label}</td><td style={tdR}>{isNum ? num(c) : money(c, { compact: true })}</td><td style={tdR}>{isNum ? num(p) : money(p, { compact: true })}</td><td style={{ ...tdR, color: vTone(v) }}>{v == null ? "—" : pct(v)}</td></tr>;
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* 2 · Sales forecast & variances */}
      <Section title="Sales forecast & variances" note="FY forecast vs year-to-date actual (annual basis)">
        {d.forecastSales == null ? <Empty>No sales forecast matched to this store. Load it under Operate → Forecast Builder.</Empty> : (
          <StatRow>
            <Stat label="FY forecast sales" value={money(d.forecastSales, { compact: true })} />
            <Stat label="YTD actual net" value={money(ytdNet, { compact: true })} />
            <Stat label="Variance to forecast" value={money(fcVar || 0, { compact: true })} tone={fcVar >= 0 ? "green" : "red"} sub={d.forecastSales ? pct((fcVar || 0) / d.forecastSales) : "—"} />
          </StatRow>
        )}
      </Section>

      {/* 3 · Summary of financial results */}
      <Section title="Summary of financial results" note="trading contribution + break-even">
        <StatRow>
          <Stat label="Net sales" value={money(k.net || 0, { compact: true })} />
          <Stat label="Gross profit" value={money(k.gm || 0, { compact: true })} sub={gmPct != null ? `${pct(gmPct)} margin` : "—"} />
          {d.breakEven ? <Stat label="Break-even" value={money(d.breakEven.breakEven, { compact: true })} sub="YTD" /> : null}
          {d.breakEven ? <Stat label="Headroom" value={money(d.breakEven.actual - d.breakEven.breakEven, { compact: true })} tone={(d.breakEven.actual - d.breakEven.breakEven) >= 0 ? "green" : "red"} sub="actual vs break-even" /> : null}
        </StatRow>
      </Section>

      {/* 4 · Sales & KPIs */}
      <Section title="Sales & KPIs">
        {!d.cy ? <Empty>No KPI data for this store.</Empty> : (
          <StatRow>
            <Stat label="ATV" value={k.atv != null ? money(k.atv) : "—"} sub="avg transaction value" />
            <Stat label="UPT" value={k.upt != null ? k.upt.toFixed(2) : "—"} sub="units per transaction" />
            <Stat label="Conversion" value={k.conversion != null ? pct(k.conversion) : "—"} sub="transactions ÷ footfall" />
            <Stat label="Footfall" value={num(k.footfall || 0)} />
            <Stat label="GM %" value={gmPct != null ? pct(gmPct) : "—"} />
          </StatRow>
        )}
      </Section>

      {/* 5 · Allocations per month vs cost of sales */}
      <Section title="Allocations per month vs cost of sales" note="monthly net sales & implied cost of sales">
        {!d.monthly?.length ? <Empty>No monthly sales for this store.</Empty> : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
                <thead><tr>{["Month", "Net sales", "Cost of sales", "Stock allocated", "Variance"].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.monthly.map((m) => {
                    const cos = gmPct != null ? m.net * (1 - gmPct) : null;
                    return <tr key={`${m.yr}-${m.mn}`}><td style={td}>{mLabel(m.yr, m.mn)}</td><td style={tdR}>{money(m.net, { compact: true })}</td><td style={tdR}>{cos == null ? "—" : money(cos, { compact: true })}</td><td style={{ ...tdR, color: "var(--faint)" }}>—</td><td style={{ ...tdR, color: "var(--faint)" }}>—</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10, lineHeight: 1.6 }}>Cost of sales is implied from the store&rsquo;s YTD gross margin. The per-store <strong>stock allocation</strong> feed (intake to store, at cost) isn&rsquo;t wired yet — that column and its variance vs cost of sales populate once the allocation data is loaded.</div>
          </>
        )}
      </Section>

      {/* 6 · Total inventory on hand */}
      <Section title="Total inventory on hand" note="from the Inventory Position master">
        {!d.inventory?.length ? <Empty>No store-level stock loaded for this store. Add it in Plan · HO → Inventory Position (store lines), then it appears here.</Empty> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 420 }}>
            <thead><tr>{["Channel", "Units", "Stock value", "As at"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 1 || i === 2 ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {d.inventory.map((r, i) => <tr key={i}><td style={td}>{r.channel}</td><td style={tdR}>{num(r.units)}</td><td style={tdR}>{money(r.value)}</td><td style={td}>{dLabel(r.through)}</td></tr>)}
              <tr style={{ fontWeight: 700 }}><td style={{ ...td, borderTop: "2px solid var(--line)" }}>Total</td><td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{num(d.inventory.reduce((t, r) => t + r.units, 0))}</td><td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(d.inventory.reduce((t, r) => t + r.value, 0))}</td><td style={{ borderTop: "2px solid var(--line)" }} /></tr>
            </tbody>
          </table>
        )}
      </Section>

      <div style={{ fontSize: 13.5, fontWeight: 650, margin: "10px 2px 10px" }}>Range SKU summaries <span style={{ fontWeight: 400, color: "var(--faint)", fontSize: 12 }}>· range-wide, not store-specific</span></div>
      <SkuSections sku={sku} />
    </div>
  );
}

// The three range-wide SKU summaries, rendered generically from the loaded report.
function SkuSections({ sku }) {
  return (
    <>
      <Section title="80/20 summary" note="top 80% / bottom 20% of the range">
        {!sku.top80?.ready ? <Empty>SKU analysis schema not present.</Empty> : !sku.top80.loaded ? <Empty>No 80/20 report loaded — upload it under Dashboards → SKU Analysis.</Empty> : (
          <>
            {sku.top80.period && <div style={{ ...faint, marginBottom: 10 }}>Period: {sku.top80.period}</div>}
            <GenericTable rows={sku.top80.top80Store} caption="Top 80% by store" />
            <GenericTable rows={sku.top80.bottom20Store} caption="Bottom 20% by store" />
          </>
        )}
      </Section>
      <Section title="New SKUs summary" note="newness performance">
        {!sku.newSku?.ready ? <Empty>SKU analysis schema not present.</Empty> : !sku.newSku.loaded ? <Empty>No New SKU report loaded.</Empty> : (
          <>
            <GenericTable rows={sku.newSku.bigPicture} caption="Big picture" />
            <GenericTable rows={sku.newSku.stars} caption="Star performers" />
          </>
        )}
      </Section>
      <Section title="Dormant SKU summary" note="non-selling lines">
        {!sku.dormant?.ready ? <Empty>SKU analysis schema not present.</Empty> : !sku.dormant.loaded ? <Empty>No Dormant SKU report loaded.</Empty> : (
          <>
            {sku.dormant.asOf && <div style={{ ...faint, marginBottom: 10 }}>As at {sku.dormant.asOf}</div>}
            <GenericTable rows={sku.dormant.kpis} caption="Headline" />
            <GenericTable rows={sku.dormant.store} caption="By store" />
          </>
        )}
      </Section>
    </>
  );
}

// Render an array of plain objects as a table, columns from the first row's keys.
function GenericTable({ rows, caption }) {
  if (!rows || !rows.length) return null;
  const cols = Object.keys(rows[0]).slice(0, 8);
  const fmt = (v) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? money(v, { compact: true }) : (Number.isInteger(v) ? num(v) : v.toFixed(2))) : (v == null ? "—" : String(v)));
  return (
    <div style={{ marginBottom: 14 }}>
      {caption && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>{caption}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 360 }}>
          <thead><tr>{cols.map((c) => <th key={c} style={{ ...th, textAlign: typeof rows[0][c] === "number" ? "right" : "left" }}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} style={typeof r[c] === "number" ? tdR : td}>{fmt(r[c])}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 650 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {note}</span>}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }) { return <div style={{ fontSize: 13, color: "var(--faint)", lineHeight: 1.6 }}>{children}</div>; }
