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
        <Tile label="Group sales FY" value={k(data.group.totals.sales)} />
        <Tile label="Variable costs" value={k(data.group.totals.variable)} sub="rate × forecast sales" />
        <Tile label="Fixed costs" value={k(data.group.totals.fixed)} sub="schedules + modelled lines" />
        <Tile label="Group EBITDA" value={k(data.group.totals.ebitda)} tone={data.group.totals.ebitda >= 0 ? "var(--green)" : "var(--red)"} />
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
        <a className="fos-btn-ghost" href="/api/forecast/export" style={{ marginLeft: "auto", textDecoration: "none" }}>Download Excel</a>
      </div>

      <PnlTable pnl={pnl} heading={heading} />

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
function PnlTable({ pnl, heading }) {
  const months = pnl.months;
  const sales = pnl.rows.filter((r) => r.kind === "SALES");
  const variable = pnl.rows.filter((r) => r.kind === "VARIABLE");
  const fixed = pnl.rows.filter((r) => r.kind === "FIXED");

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 8 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
        <thead><tr>
          <th style={th({ sticky: true })}>{heading}</th>
          {months.map((m) => <th key={m} style={th({ right: true })}>{m}</th>)}
          <th style={th({ right: true, strong: true })}>FY</th>
        </tr></thead>
        <tbody>
          <SectionHead label="Sales" span={months.length + 2} />
          {sales.map((r) => <LineRow key={r.line_label} r={r} months={months} />)}
          <TotalRow label="Total sales" t={pnl.totals.sales} months={months} />

          <SectionHead label="Variable costs" span={months.length + 2} />
          {variable.map((r) => <LineRow key={r.line_label} r={r} months={months} />)}
          {pnl.hasLabour && <TotalRow label="Employment costs" t={pnl.totals.employment} months={months} sub />}
          <TotalRow label="Total variable costs" t={pnl.totals.variable} months={months} />

          <SectionHead label="Fixed costs" span={months.length + 2} />
          {fixed.map((r) => <LineRow key={r.line_label} r={r} months={months} />)}
          <TotalRow label="Total fixed costs" t={pnl.totals.fixed} months={months} />

          <TotalRow label="EBITDA" t={pnl.totals.ebitda} months={months} ebitda />
        </tbody>
      </table>
    </div>
  );
}

function SectionHead({ label, span }) {
  return <tr><td colSpan={span} style={{ padding: "12px 12px 5px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{label}</td></tr>;
}
function LineRow({ r, months }) {
  return (
    <tr>
      <td style={td({ sticky: true })}>{r.line_label}</td>
      {months.map((m) => <td key={m} className="fos-num" style={td({ right: true, tone: "var(--muted)" })}>{cell(r.months[m])}</td>)}
      <td className="fos-num" style={td({ right: true, strong: true })}>{cell(r.total)}</td>
    </tr>
  );
}
function TotalRow({ label, t, months, ebitda, sub }) {
  const tone = ebitda ? (t.total >= 0 ? "var(--green)" : "var(--red)") : (sub ? "var(--muted)" : undefined);
  const top = !sub;
  return (
    <tr>
      <td style={{ ...td({ sticky: true, strong: !sub, top }), fontStyle: sub ? "italic" : undefined, color: sub ? "var(--muted)" : undefined, paddingLeft: sub ? 22 : undefined }}>{label}</td>
      {months.map((m) => {
        const v = t.months[m] || 0;
        return <td key={m} className="fos-num" style={td({ right: true, strong: !sub, top, tone: ebitda ? (v >= 0 ? "var(--green)" : "var(--red)") : (sub ? "var(--muted)" : undefined) })}>{cell(v)}</td>;
      })}
      <td className="fos-num" style={td({ right: true, strong: true, top, tone })}>{cell(t.total)}</td>
    </tr>
  );
}

const cell = (v) => (v == null || v === 0 ? "·" : money(v, { compact: true }));

const th = ({ right, sticky, strong } = {}) => ({
  textAlign: right ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: strong ? 700 : 600,
  fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)",
  borderBottom: "1px solid var(--line)", whiteSpace: "nowrap",
  ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 } : {}),
});
const td = ({ right, strong, tone, sticky, top } = {}) => ({
  textAlign: right ? "right" : "left", padding: "7.5px 12px", whiteSpace: "nowrap",
  borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400,
  borderTop: top ? "1px solid var(--line)" : undefined,
  color: tone || "var(--ink)",
  ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 } : {}),
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
