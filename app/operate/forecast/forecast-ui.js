"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

/* Operate forecast inputs — per-scope monthly workings and the full nominal
   P&L (sales → EBITDA). Pick a store to see its own full forecast; CSV/workbook
   upload and the per-store sales list below. */

const SCOPES = [["STORES", "Company stores"], ["HEAD_OFFICE", "Head office"], ["FRANCHISE", "Franchise"]];
const CSV_TEMPLATE = "Scope,Unit,Line,Cost Type,Month,Value\nSTORES,Camden,ST: Sales,SALES,2026-07,150000\nSTORES,Camden,ST: Cost of Goods Sold,VARIABLE_RATE,,0.40\nSTORES,Camden,ST: Rent,FIXED,2026-07,33750\nHEAD_OFFICE,,HO: Rent,FIXED,2026-07,6432.75\nFRANCHISE,,FR: Franchise Fee - Royalties,SALES,2026-07,65000\n";

async function post(body) {
  const res = await fetch("/api/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const k = (v) => money(v, { compact: true });

export default function ForecastUI({ data, ready, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("STORES");
  const [view, setView] = useState("monthly"); // "monthly" | "annual"
  const [year, setYear] = useState(""); // "" = all years (monthly view)

  if (!ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>One migration to run</div>
      This screen needs migration <span style={{ fontFamily: "var(--mono)" }}>013_forecast_inputs.sql</span> —
      it creates the forecast input and scenario tables (idempotent). Run it, refresh, then load the forecast workbook.
    </div>;
  }
  if (!data) {
    return <div>
      <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)", marginBottom: 14 }}>
        No forecast inputs loaded yet — upload the 3-tab store forecast workbook (Sales Forecast · Cost Assumptions · Labour Seasonality)
        and the store-level workings, built from sales down to EBITDA by nominal, appear here.
      </div>
      {canManage && <Upload onDone={() => router.refresh()} />}
    </div>;
  }

  const onStores = tab === "STORES";
  const selected = onStores ? data.selectedStore : null;
  const storeTotals = data.scopeTotals?.STORES || data.group.totals; // headline = company stores only (HO & franchise reported separately)
  const years = [...new Set(data.months.map((m) => m.slice(0, 4)))].sort();
  // On the STORES tab with a store selected, show that store's own P&L;
  // otherwise the scope aggregate.
  const pnl = selected && data.storePnl ? data.storePnl : data.nominalByScope[tab];
  const scopeLabel = SCOPES.find(([s]) => s === tab)[1];
  const heading = selected ? selected : `${scopeLabel} — all`;

  function selectStore(store) {
    router.push(store ? `/operate/forecast?store=${encodeURIComponent(store)}` : "/operate/forecast");
  }

  return (
    <>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 26 }}>
        <Tile label="Store sales FY" value={k(storeTotals.sales)} sub="company stores" />
        <Tile label="Variable costs" value={k(storeTotals.variable)} sub="rate × forecast sales" />
        <Tile label="Fixed costs" value={k(storeTotals.fixed)} sub="schedules + labour" />
        <Tile label="Store EBITDA" value={k(storeTotals.ebitda)} tone={storeTotals.ebitda >= 0 ? "var(--green)" : "var(--red)"} sub="franchise reported separately" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
          {SCOPES.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              fontSize: 12.5, fontWeight: tab === key ? 600 : 500, padding: "6px 13px", borderRadius: 7, border: `1px solid ${tab === key ? "var(--line-strong)" : "transparent"}`,
              background: tab === key ? "var(--surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-1)" : "none",
              color: tab === key ? "var(--ink)" : "var(--muted)",
            }}>{label}</button>
          ))}
        </div>

        {onStores && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--faint)" }}>
            Store
            <select className="fos-input" value={selected || ""} onChange={(e) => selectStore(e.target.value)}
              style={{ fontSize: 12.5, padding: "6px 10px", minWidth: 190 }}>
              <option value="">All company stores</option>
              {data.storeSales.map((s) => <option key={s.store} value={s.store}>{s.store}</option>)}
            </select>
          </label>
        )}
        {selected && <button className="fos-btn-ghost" onClick={() => selectStore("")}>Clear</button>}

        {view === "monthly" && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto", fontSize: 12.5, color: "var(--faint)" }}>
            Year
            <select className="fos-input" value={year} onChange={(e) => setYear(e.target.value)} style={{ fontSize: 12.5, padding: "6px 10px" }}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: "inline-flex", gap: 3, marginLeft: view === "monthly" ? 0 : "auto", padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
          {[["monthly", "Monthly"], ["annual", "By year (YoY)"]].map(([key, label]) => (
            <button key={key} onClick={() => setView(key)} style={{
              fontSize: 12, fontWeight: view === key ? 600 : 500, padding: "6px 12px", borderRadius: 7, border: `1px solid ${view === key ? "var(--line-strong)" : "transparent"}`,
              background: view === key ? "var(--surface)" : "transparent", boxShadow: view === key ? "var(--shadow-1)" : "none", color: view === key ? "var(--ink)" : "var(--muted)",
            }}>{label}</button>
          ))}
        </div>
        <a className="fos-btn-ghost" href="/api/forecast/export" style={{ textDecoration: "none" }}>Download Excel</a>
      </div>

      {view === "annual"
        ? <AnnualTable pnl={pnl} heading={heading} />
        : <PnlTable pnl={pnl} heading={heading} months={year ? pnl.months.filter((m) => m.startsWith(year)) : pnl.months} />}

      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 20, marginBottom: 18, lineHeight: 1.5 }}>
        Workings: variable costs are each store's rates × its forecast sales; head office and franchise carry the
        modelled monthly lines. Scenario planning on the <a href="/plan/scenarios" style={{ color: "var(--accent)" }}>Plan tab</a> flexes
        these inputs. {Object.entries(data.counts).map(([s, n]) => `${s.toLowerCase().replace("_", " ")} ${n}`).join(" · ")} input lines.
      </div>

      {canManage && <Upload onDone={() => router.refresh()} />}
    </>
  );
}

/* The full nominal P&L: sales lines → total, variable lines → total, fixed
   lines → total, then EBITDA — across every month plus an FY column. */
function PnlTable({ pnl, heading, months: monthsProp }) {
  const months = monthsProp || pnl.months;
  const sumCols = (mmap) => months.reduce((t, m) => t + (mmap[m] || 0), 0);
  const sales = pnl.rows.filter((r) => r.kind === "SALES");
  const variable = pnl.rows.filter((r) => r.kind === "VARIABLE");
  const fixed = pnl.rows.filter((r) => r.kind === "FIXED");

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
        <thead><tr>
          <th style={th({ sticky: true })}>{heading}</th>
          {months.map((m) => <th key={m} style={th({ right: true })}>{m}</th>)}
          <th style={th({ right: true, strong: true })}>{months.length <= 12 ? "Total" : "FY"}</th>
        </tr></thead>
        <tbody>
          <SectionHead label="Sales" span={months.length + 2} />
          {sales.map((r) => <LineRow key={r.line_label} r={r} months={months} sumCols={sumCols} />)}
          <TotalRow label="Total sales" t={pnl.totals.sales} months={months} sumCols={sumCols} />

          <SectionHead label="Variable costs" span={months.length + 2} />
          {variable.map((r) => <LineRow key={r.line_label} r={r} months={months} sumCols={sumCols} />)}
          {pnl.hasLabour && <TotalRow label="Employment costs" t={pnl.totals.employment} months={months} sumCols={sumCols} sub />}
          <TotalRow label="Total variable costs" t={pnl.totals.variable} months={months} sumCols={sumCols} />

          <SectionHead label="Fixed costs" span={months.length + 2} />
          {fixed.map((r) => <LineRow key={r.line_label} r={r} months={months} sumCols={sumCols} />)}
          <TotalRow label="Total fixed costs" t={pnl.totals.fixed} months={months} sumCols={sumCols} />

          <TotalRow label="EBITDA" t={pnl.totals.ebitda} months={months} sumCols={sumCols} ebitda />
        </tbody>
      </table>
    </div>
  );
}

/* Multi-year view: forecast years side by side (FY2026/27/28) with year-on-year
   growth between them, sales → EBITDA by nominal. Prior-year actuals will slot
   in as a leading column once that data is loaded. */
function AnnualTable({ pnl, heading }) {
  const years = [...new Set(pnl.months.map((m) => m.slice(0, 4)))].sort();
  const sumY = (mmap, y) => pnl.months.filter((m) => m.startsWith(y)).reduce((t, m) => t + (mmap[m] || 0), 0);
  const byYear = (mmap) => years.map((y) => sumY(mmap, y));
  const sales = pnl.rows.filter((r) => r.kind === "SALES");
  const variable = pnl.rows.filter((r) => r.kind === "VARIABLE");
  const fixed = pnl.rows.filter((r) => r.kind === "FIXED");
  const nCols = 1 + years.length + Math.max(0, years.length - 1);

  // cost=true → a rising cost is adverse (red); otherwise (sales, EBITDA) a rise
  // is favourable (green). Nil-growth cells stay faint.
  const Row = ({ label, vals, strong, sub, ebitda, top, cost }) => (
    <tr>
      <td style={{ ...td({ sticky: true, strong: strong && !sub, top }), ...(sub ? { fontStyle: "italic", color: "var(--muted)", paddingLeft: 34 } : {}) }}>{label}</td>
      {years.map((y, i) => {
        const v = vals[i], prev = vals[i - 1];
        const growth = i > 0 && prev ? v / prev - 1 : null;
        const favourable = growth == null ? null : (cost ? growth <= 0 : growth >= 0);
        return [
          <td key={y} className="fos-num" style={td({ right: true, strong: strong && !sub, top, tone: ebitda ? (v >= 0 ? "var(--green)" : "var(--red)") : (sub ? "var(--muted)" : undefined) })}>{cell(v)}</td>,
          i > 0 ? <td key={y + "g"} className="fos-num" style={td({ right: true, top, tone: growth == null ? "var(--faint)" : (favourable ? "var(--green)" : "var(--red)") })}>{growth == null ? "·" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}</td> : null,
        ];
      })}
    </tr>
  );

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
        <thead><tr>
          <th style={th({ sticky: true })}>{heading}</th>
          {years.map((y, i) => [
            <th key={y} style={th({ right: true, strong: true })}>FY{y}</th>,
            i > 0 ? <th key={y + "g"} style={th({ right: true })}>YoY</th> : null,
          ])}
        </tr></thead>
        <tbody>
          <SectionHead label="Sales" span={nCols} />
          {sales.map((r) => <Row key={r.line_label} label={r.line_label} vals={byYear(r.months)} />)}
          <Row label="Total sales" vals={byYear(pnl.totals.sales.months)} strong top />
          <SectionHead label="Variable costs" span={nCols} />
          {variable.map((r) => <Row key={r.line_label} label={r.line_label} vals={byYear(r.months)} cost />)}
          {pnl.hasLabour && <Row label="Employment costs" vals={byYear(pnl.totals.employment.months)} strong sub cost />}
          <Row label="Total variable costs" vals={byYear(pnl.totals.variable.months)} strong top cost />
          <SectionHead label="Fixed costs" span={nCols} />
          {fixed.map((r) => <Row key={r.line_label} label={r.line_label} vals={byYear(r.months)} cost />)}
          <Row label="Total fixed costs" vals={byYear(pnl.totals.fixed.months)} strong top cost />
          <Row label="EBITDA" vals={byYear(pnl.totals.ebitda.months)} strong top ebitda />
        </tbody>
      </table>
    </div>
  );
}

function SectionHead({ label, span }) {
  return <tr><td colSpan={span} style={{ padding: "12px 12px 5px 22px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{label}</td></tr>;
}
function LineRow({ r, months, sumCols }) {
  return (
    <tr>
      <td style={td({ sticky: true })}>{r.line_label}</td>
      {months.map((m) => <td key={m} className="fos-num" style={td({ right: true, tone: "var(--muted)" })}>{cell(r.months[m])}</td>)}
      <td className="fos-num" style={td({ right: true, strong: true })}>{cell(sumCols(r.months))}</td>
    </tr>
  );
}
function TotalRow({ label, t, months, sumCols, ebitda, sub }) {
  const totalVal = sumCols(t.months);
  const tone = ebitda ? (totalVal >= 0 ? "var(--green)" : "var(--red)") : (sub ? "var(--muted)" : undefined);
  const top = !sub;
  return (
    <tr>
      <td style={{ ...td({ sticky: true, strong: !sub, top }), ...(sub ? { fontStyle: "italic", color: "var(--muted)", paddingLeft: 34 } : {}) }}>{label}</td>
      {months.map((m) => {
        const v = t.months[m] || 0;
        return <td key={m} className="fos-num" style={td({ right: true, strong: !sub, top, tone: ebitda ? (v >= 0 ? "var(--green)" : "var(--red)") : (sub ? "var(--muted)" : undefined) })}>{cell(v)}</td>;
      })}
      <td className="fos-num" style={td({ right: true, strong: true, top, tone })}>{cell(totalVal)}</td>
    </tr>
  );
}

const cell = (v) => (v == null || v === 0 ? "·" : money(v, { compact: true }));

const th = ({ right, sticky, strong } = {}) => ({
  textAlign: right ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: strong ? 700 : 600,
  fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)",
  borderBottom: "1px solid var(--line)", whiteSpace: "nowrap",
  ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", zIndex: 1, paddingLeft: 22 } : {}),
});
const td = ({ right, strong, tone, sticky, top } = {}) => ({
  textAlign: right ? "right" : "left", padding: "7.5px 12px", whiteSpace: "nowrap",
  borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400,
  borderTop: top ? "1px solid var(--line)" : undefined,
  color: tone || "var(--ink)",
  ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", zIndex: 1, paddingLeft: 22 } : {}),
});

function Tile({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 27, fontWeight: 650, lineHeight: 1, letterSpacing: "-.025em", color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

function Upload({ onDone }) {
  const fileRef = useRef(null);
  const wbRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState("Loading…");
    try {
      const csv = await f.text();
      const r = await post({ action: "upload", csv });
      setState(`Loaded ${r.loaded} input lines${r.errors?.length ? ` · ${r.errors.length} row error(s) skipped` : ""}.`);
      onDone();
    } catch (x) { setState(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function onWorkbook(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState("Reading workbook…");
    try {
      const buf = await f.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const file = btoa(bin);
      const r = await post({ action: "workbook", file });
      setState(`Loaded ${r.loaded} lines · ${r.stores} stores · ${r.months} months${r.warnings?.length ? ` · ${r.warnings.length} warning(s)` : ""}.`);
      onDone();
    } catch (x) { setState(x.message); }
    finally { if (wbRef.current) wbRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
        <button className="fos-btn" onClick={() => wbRef.current?.click()}>Upload forecast workbook (3 tabs)</button>
        <span>Sales Forecast · Cost Assumptions · Labour Seasonality — store-level. Amends &amp; adds; partial uploads welcome.</span>
        <input ref={wbRef} type="file" accept=".xlsx,.xlsb,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onWorkbook} style={{ display: "none" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
        <button className="fos-btn-ghost" onClick={() => fileRef.current?.click()}>Upload forecast (CSV)</button>
        <a className="fos-btn-ghost" style={{ textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="forecast-template.csv">Template</a>
        <span>Single-line upserts on scope · unit · line · type · month.</span>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
      </div>
      {state && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{state}</span>}
    </div>
  );
}
