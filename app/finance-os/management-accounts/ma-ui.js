"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../ui";

/* Management accounts — store-level P&L blending Actuals (lead where a month has
   them) with the Forecast forward, against Budget (the frozen forecast). Excel
   upload of actuals; year selector; variance vs budget. */

async function post(body) {
  const res = await fetch("/api/management-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}
const k = (v) => money(v, { compact: true });
const cell = (v) => (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));

export default function MaUI({ data, canManage }) {
  const router = useRouter();

  if (!data.ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>One migration to run</div>
      Store-level management accounts need migration <span style={{ fontFamily: "var(--mono)" }}>019_mgmt_actual.sql</span> (idempotent). Run it, refresh, then upload the actuals workbook.
    </div>;
  }
  if (!data.loaded) {
    return <div>
      <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)", marginBottom: 14 }}>
        No actuals or forecast loaded yet — upload the management-accounts actuals workbook (Entity · Store · Month · Nominal · Value) and the P&L appears, with actuals leading each month they cover and the forecast carrying the rest.
      </div>
      {canManage && <Upload onDone={() => router.refresh()} />}
    </div>;
  }

  const ma = data.ma;
  const years = [...new Set(ma.months.map((m) => m.slice(0, 4)))].sort();
  // open on the current actual year — the one holding the most recent actual month
  const latestActual = ma.actualMonths[ma.actualMonths.length - 1];
  const [year, setYear] = useState((latestActual || ma.months[0] || years[0]).slice(0, 4));

  const ymOf = ma.months.filter((m) => m.startsWith(year));
  const sum = (mmap) => ymOf.reduce((t, m) => t + (mmap[m] || 0), 0);
  const actualsInYear = ymOf.filter((m) => ma.isActualMonth[m]);
  const lastActual = actualsInYear[actualsInYear.length - 1];

  const revenue = ma.rows.filter((r) => r.kind === "REVENUE");
  const costs = ma.rows.filter((r) => r.kind === "COST");
  const t = ma.totals;

  return (
    <>
      {/* headline tiles for the selected year */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 22 }}>
        <Tile label={`Revenue ${year}`} value={k(sum(t.current.revenue.months))} sub={actualsInYear.length ? `actual to ${lastActual}` : "forecast"} />
        <Tile label="vs budget" value={k(sum(t.current.revenue.months) - sum(t.budget.revenue.months))} tone={sum(t.current.revenue.months) - sum(t.budget.revenue.months) >= 0 ? "var(--green)" : "var(--red)"} sub="revenue variance" />
        <Tile label={`EBITDA ${year}`} value={k(sum(t.current.ebitda.months))} tone={sum(t.current.ebitda.months) >= 0 ? "var(--green)" : "var(--red)"} />
        <Tile label="EBITDA vs budget" value={k(sum(t.current.ebitda.months) - sum(t.budget.ebitda.months))} tone={sum(t.current.ebitda.months) - sum(t.budget.ebitda.months) >= 0 ? "var(--green)" : "var(--red)"} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--faint)" }}>
          Year
          <select className="fos-input" value={year} onChange={(e) => setYear(e.target.value)} style={{ fontSize: 12.5, padding: "6px 10px" }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>
          {actualsInYear.length === ymOf.length ? "Full year actual"
            : actualsInYear.length ? `Actuals to ${lastActual}, forecast thereafter`
            : "Forecast (no actuals yet)"} · company stores · all
        </span>
      </div>

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 20 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
          <thead><tr>
            {["", "Budget", "Actual / forecast", "Variance", "Var %"].map((h, i) => (
              <th key={i} style={th(i > 0)}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            <Section label="Revenue" />
            {revenue.map((r) => <Row key={r.line_label} label={r.line_label} b={sum(r.budget)} c={sum(r.current)} rev />)}
            <Row label="Total revenue" b={sum(t.budget.revenue.months)} c={sum(t.current.revenue.months)} rev strong top />
            <Section label="Operating costs" />
            {costs.map((r) => <Row key={r.line_label} label={r.line_label} b={sum(r.budget)} c={sum(r.current)} cost />)}
            <Row label="Total operating costs" b={sum(t.budget.cost.months)} c={sum(t.current.cost.months)} cost strong top />
            <Row label="EBITDA" b={sum(t.budget.ebitda.months)} c={sum(t.current.ebitda.months)} rev strong top ebitda />
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 18, lineHeight: 1.5 }}>
        Actuals lead any month they cover; the forecast carries the forward months. Budget is the frozen full-year forecast.
        {" "}{data.counts.actuals.toLocaleString()} actual · {data.counts.forecast.toLocaleString()} forecast input lines.
      </div>

      {canManage && <Upload onDone={() => router.refresh()} />}
    </>
  );
}

function Row({ label, b, c, rev, cost, strong, top, ebitda }) {
  const variance = c - b;
  // favourable: revenue/EBITDA up = good; cost up = bad
  const favourable = cost ? variance <= 0 : variance >= 0;
  const vTone = Math.round(variance) === 0 ? "var(--faint)" : (favourable ? "var(--green)" : "var(--red)");
  const pctv = b ? variance / Math.abs(b) : null;
  return (
    <tr>
      <td style={td({ sticky: true, strong: strong, top, ebitda })}>{label}</td>
      <td className="fos-num" style={td({ right: true, top })}>{cell(b)}</td>
      <td className="fos-num" style={td({ right: true, strong, top, tone: ebitda ? (c >= 0 ? "var(--green)" : "var(--red)") : undefined })}>{cell(c)}</td>
      <td className="fos-num" style={td({ right: true, top, tone: vTone })}>{Math.round(variance) === 0 ? "·" : (variance > 0 ? "+" : "") + money(variance, { compact: true })}</td>
      <td className="fos-num" style={td({ right: true, top, tone: vTone })}>{pctv == null ? "·" : `${pctv >= 0 ? "+" : ""}${(pctv * 100).toFixed(1)}%`}</td>
    </tr>
  );
}
function Section({ label }) {
  return <tr><td colSpan={5} style={{ padding: "11px 12px 5px 20px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{label}</td></tr>;
}
const th = (right) => ({ textAlign: right ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", ...(right ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: 20 }) });
const td = ({ right, strong, tone, sticky, top, ebitda } = {}) => ({ textAlign: right ? "right" : "left", padding: "7.5px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, borderTop: top ? "1px solid var(--line)" : undefined, color: tone || "var(--ink)", ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: 20 } : {}) });

function Tile({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 25, fontWeight: 650, lineHeight: 1, letterSpacing: "-.02em", color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

function Upload({ onDone }) {
  const wbRef = useRef(null);
  const [state, setState] = useState("");
  async function onWorkbook(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setState("Reading workbook…");
    try {
      const buf = await f.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const r = await post({ action: "workbook", file: btoa(bin) });
      setState(`Loaded ${r.loaded.toLocaleString()} actual lines · ${r.stores} stores · ${r.months} months.`);
      onDone();
    } catch (x) { setState(x.message); }
    finally { if (wbRef.current) wbRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
      <button className="fos-btn" onClick={() => wbRef.current?.click()}>Upload actuals (Excel)</button>
      <span>Entity · Store · Month · Nominal · Value — one row per store/nominal/month. Amends &amp; adds; upserts on store · nominal · month.</span>
      <input ref={wbRef} type="file" accept=".xlsx,.xlsb,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onWorkbook} style={{ display: "none" }} />
      {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
    </div>
  );
}
