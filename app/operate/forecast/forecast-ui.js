"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, Badge } from "../../finance-os/ui";

/* Operate forecast inputs — per-scope monthly workings (sales − variable −
   fixed = EBITDA), the per-store forward look, CSV upload and manual entry. */

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
      it creates the forecast input and scenario tables (idempotent). Run it, refresh, then load the forecast CSV.
    </div>;
  }
  if (!data) {
    return <div>
      <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--faint)", marginBottom: 14 }}>
        No forecast inputs loaded yet — upload the 3-tab store forecast workbook (Sales Forecast · Cost Assumptions · Labour Seasonality)
        and the store-level workings, rolled up to entity and group, appear here. Fixed costs, variable costs and sales all build from it.
      </div>
      {canManage && <Upload onDone={() => router.refresh()} />}
    </div>;
  }

  const scope = data.byScope[tab];
  const months = data.months;

  return (
    <>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 26 }}>
        <Tile label="Group sales FY26" value={k(data.group.totals.sales)} />
        <Tile label="Variable costs" value={k(data.group.totals.variable)} sub="rate × forecast sales" />
        <Tile label="Fixed costs" value={k(data.group.totals.fixed)} sub="schedules + modelled lines" />
        <Tile label="Group EBITDA" value={k(data.group.totals.ebitda)} tone={data.group.totals.ebitda >= 0 ? "var(--green)" : "var(--red)"} />
      </div>

      <div style={{ display: "inline-flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
        {SCOPES.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize: 12.5, fontWeight: tab === key ? 600 : 500, padding: "6px 13px", borderRadius: 7, border: `1px solid ${tab === key ? "var(--line-strong)" : "transparent"}`,
            background: tab === key ? "var(--surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-1)" : "none",
            color: tab === key ? "var(--ink)" : "var(--muted)",
          }}>{label}</button>
        ))}
      </div>

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 24 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
          <thead><tr>
            <th style={th({ sticky: true })}>{SCOPES.find(([s]) => s === tab)[1]}</th>
            {months.map((m) => <th key={m} style={th({ right: true })}>{m}</th>)}
            <th style={th({ right: true })}>FY</th>
          </tr></thead>
          <tbody>
            {[["Sales", "sales"], ["Variable costs", "variable"], ["Fixed costs", "fixed"], ["EBITDA", "ebitda"]].map(([label, key], ri) => (
              <tr key={key}>
                <td style={td({ sticky: true, strong: key === "ebitda" })}>{label}</td>
                {months.map((m) => {
                  const v = scope.months[m][key];
                  return <td key={m} className="fos-num" style={td({ right: true, strong: key === "ebitda", tone: key === "ebitda" ? (v >= 0 ? "var(--green)" : "var(--red)") : undefined })}>{money(v, { compact: true })}</td>;
                })}
                <td className="fos-num" style={td({ right: true, strong: true, tone: key === "ebitda" ? (scope.totals[key] >= 0 ? "var(--green)" : "var(--red)") : undefined })}>{money(scope.totals[key], { compact: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tab === "STORES" && data.byEntity?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>Forecast sales by entity</span>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· stores roll up to {data.byEntity.length} entities below group</span>
          </div>
          <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {data.byEntity.map((e) => {
                  const max = data.byEntity[0]?.sales || 1;
                  return (
                    <tr key={e.entity}>
                      <td style={td({})}>{e.entity}<span style={{ color: "var(--faint)", marginLeft: 8, fontSize: 11.5 }}>{e.stores} store{e.stores === 1 ? "" : "s"}</span></td>
                      <td className="fos-num" style={td({ right: true })}>{money(e.sales)}</td>
                      <td style={{ ...td({}), width: "38%" }}>
                        <span style={{ display: "block", height: 7, borderRadius: 4, width: `${(e.sales / max) * 100}%`, background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 45%, transparent), var(--accent))" }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "STORES" && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 650 }}>Forecast sales by store</span>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {data.storeSales.length} stores from the model</span>
          </div>
          <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {data.storeSales.map((s) => {
                  const max = data.storeSales[0]?.sales || 1;
                  return (
                    <tr key={s.store}>
                      <td style={td({})}>{s.store}{s.entity && <span style={{ color: "var(--faint)", marginLeft: 8, fontSize: 11.5 }}>{s.entity}</span>}</td>
                      <td className="fos-num" style={td({ right: true })}>{money(s.sales)}</td>
                      <td style={{ ...td({}), width: "40%" }}>
                        <span style={{ display: "block", height: 7, borderRadius: 4, width: `${(s.sales / max) * 100}%`, background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))" }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 18, lineHeight: 1.5 }}>
        Workings: variable costs are each store's rates × its forecast sales; head office and franchise carry the
        modelled monthly lines. Scenario planning on the <a href="/plan/scenarios" style={{ color: "var(--accent)" }}>Plan tab</a> flexes
        these inputs. Loaded from the Q3 forecast models · {Object.entries(data.counts).map(([s, n]) => `${s.toLowerCase().replace("_", " ")} ${n}`).join(" · ")} input lines.
      </div>

      {canManage && <Upload onDone={() => router.refresh()} />}
    </>
  );
}

const th = ({ right, sticky } = {}) => ({
  textAlign: right ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600,
  fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)",
  borderBottom: "1px solid var(--line)", whiteSpace: "nowrap",
  ...(sticky ? { position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 } : {}),
});
const td = ({ right, strong, tone, sticky } = {}) => ({
  textAlign: right ? "right" : "left", padding: "8.5px 12px", whiteSpace: "nowrap",
  borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400,
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
      setState(`Loaded ${r.loaded} lines · ${r.stores} stores · ${r.entities} entities · ${r.months} months${r.warnings?.length ? ` · ${r.warnings.length} warning(s)` : ""}.`);
      onDone();
    } catch (x) { setState(x.message); }
    finally { if (wbRef.current) wbRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
        <button className="fos-btn" onClick={() => wbRef.current?.click()}>Upload forecast workbook (3 tabs)</button>
        <span>Sales Forecast · Cost Assumptions · Labour Seasonality — store-level, rolled up to entity. Amends & adds; partial uploads welcome.</span>
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
