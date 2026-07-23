"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { money } from "../ui";

const TABS = [
  { key: "group", label: "Group P&L", dataset: "group_pl" },
  { key: "stores", label: "Store forward-look", dataset: "store" },
  { key: "monthly", label: "Monthly EBITDA", dataset: "store_month" },
  { key: "bekpi", label: "Break-even & KPIs", dataset: null },
];
const k000 = (v) => (v == null ? "—" : money(Number(v) * 1000, { compact: true }));   // model is in £'000
const pctv = (v) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const TRAJ = { Growth: "var(--green)", Stable: "var(--muted)", Decline: "var(--red)" };
const th = { textAlign: "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = (extra = {}) => ({ padding: "8px 12px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", ...extra });
const rt = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

async function api(body) {
  const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Upload failed");
  return d;
}

// group P&L line -> real Xero actual (in £, converted to £'000 for display parity)
function actualFor(line, xero) {
  if (!xero) return null;
  const m = {
    "Total Sales": xero.revenue, "Cost of Sales": Math.abs(xero.cogs || 0), "Gross Profit": xero.grossProfit,
    "Total Op. Costs": Math.abs(xero.opex || 0), "EBITDA": xero.netResult, "Net Profit": xero.netResult,
  };
  if (line === "Gross Margin %") return xero.grossMargin;
  const v = m[line];
  return v == null ? null : v / 1000;
}

export default function BudgetForecastUI({ groupPl, stores, monthly, breakeven, kpi, xero, scope, canManage, loaded }) {
  const [tab, setTab] = useState("group");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const connCount = scope?.count || 0;

  if (!loaded) {
    return (
      <div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
          No plan loaded yet. {canManage ? "Upload your Budget & Forecast workbook to fill every tab at once — or load individual datasets by CSV below." : "Ask ADMIN/FINANCE to upload the plan."}
        </div>
        {canManage && <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <WorkbookUpload setMsg={setMsg} setErr={setErr} />
          <span style={{ fontSize: 12, color: "var(--faint)" }}>or per dataset:</span>
          {["group_pl", "store", "store_month", "breakeven", "kpi"].map((d) => <Upload key={d} dataset={d} label={d} setMsg={setMsg} setErr={setErr} />)}
        </div>}
        {msg && <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 10 }}>{msg}</div>}
        {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return <button key={t.key} onClick={() => { setTab(t.key); setMsg(""); setErr(""); }} style={{
            fontSize: 12.5, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`, background: on ? "var(--accent-bg)" : "transparent",
            color: on ? "var(--accent)" : "var(--muted)", fontWeight: on ? 700 : 500 }}>{t.label}</button>;
        })}
      </div>

      {canManage && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <WorkbookUpload setMsg={setMsg} setErr={setErr} />
          <span style={{ fontSize: 12, color: "var(--faint)" }}>or this tab:</span>
          {tab === "bekpi"
            ? (<><Upload dataset="breakeven" label="Break-even CSV" setMsg={setMsg} setErr={setErr} /><Upload dataset="kpi" label="KPI CSV" setMsg={setMsg} setErr={setErr} /></>)
            : <Upload dataset={TABS.find((t) => t.key === tab).dataset} label="Upload CSV (replaces this dataset)" setMsg={setMsg} setErr={setErr} />}
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: "var(--green)", marginBottom: 10 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>{err}</div>}

      {tab === "group" && (
        <>
          <Card>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 640 }}>
              <thead><tr>
                <th style={th}>£ line</th><th style={{ ...th, ...rt }}>2025 A</th><th style={{ ...th, ...rt }}>2026 A+F</th>
                <th style={{ ...th, ...rt }}>2027 B</th><th style={{ ...th, ...rt }}>2028 B</th><th style={{ ...th, ...rt }}>Beta</th>
                <th style={{ ...th, ...rt }}>Actual (conn.)</th>
              </tr></thead>
              <tbody>{groupPl.map((r) => {
                const ratio = r.is_ratio;
                const fmt = (v) => (ratio ? pctv(v) : k000(v));
                const act = actualFor(r.line_label, xero);
                const strong = ["EBITDA", "Gross Profit", "Total Sales", "Net Profit"].includes(r.line_label);
                return (
                  <tr key={r.id}>
                    <td style={td({ fontWeight: strong ? 700 : 560 })}>{r.line_label}</td>
                    <td style={td(rt)}>{fmt(r.y2025a)}</td>
                    <td style={td({ ...rt, fontWeight: strong ? 700 : 400 })}>{fmt(r.y2026)}</td>
                    <td style={td(rt)}>{fmt(r.y2027)}</td>
                    <td style={td(rt)}>{fmt(r.y2028)}</td>
                    <td style={td({ ...rt, color: "var(--faint)" })}>{r.beta == null ? "—" : pctv(r.beta)}</td>
                    <td style={td({ ...rt, color: "var(--accent)" })}>{act == null ? "—" : ratio ? pctv(act) : k000(act)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Card>
          <Note>Plan figures are your Budget &amp; Forecast model (£, shown compact). <strong>Actual (conn.)</strong> is the real Xero
            actual for the {connCount} connected {connCount === 1 ? "entity" : "entities"} only — a partial figure beside the group plan, not a like-for-like.</Note>
        </>
      )}

      {tab === "stores" && (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead><tr>
              <th style={th}>Store</th><th style={{ ...th, ...rt }}>2025</th><th style={{ ...th, ...rt }}>2026</th><th style={{ ...th, ...rt }}>2027</th>
              <th style={{ ...th, ...rt }}>2028</th><th style={{ ...th, ...rt }}>Beta</th><th style={{ ...th, ...rt }}>EBITDA 28</th>
              <th style={{ ...th, ...rt }}>Mgn</th><th style={{ ...th, ...rt }}>2030</th><th style={th}>Trajectory</th>
            </tr></thead>
            <tbody>{stores.map((s) => (
              <tr key={s.id}>
                <td style={td({ fontWeight: 560 })}>{s.store_name}</td>
                <td style={td(rt)}>{k000(s.s2025)}</td><td style={td(rt)}>{k000(s.s2026)}</td><td style={td(rt)}>{k000(s.s2027)}</td><td style={td(rt)}>{k000(s.s2028)}</td>
                <td style={td({ ...rt, color: "var(--faint)" })}>{pctv(s.beta)}</td>
                <td style={td(rt)}>{k000(s.ebitda2028)}</td><td style={td({ ...rt, color: "var(--faint)" })}>{pctv(s.ebitda_mgn)}</td>
                <td style={td(rt)}>{k000(s.s2030)}</td>
                <td style={td()}><span style={{ fontSize: 11, fontWeight: 600, color: TRAJ[s.trajectory] || "var(--muted)" }}>{s.trajectory || "—"}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      {tab === "monthly" && (
        <>
          <Card>
            <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
              <thead><tr>
                <th style={{ ...th, position: "sticky", left: 0, background: "var(--surface)" }}>Store</th>
                {monthly.months.map((m) => <th key={m} style={{ ...th, ...rt, padding: "8px 6px" }}>{m.slice(2).replace("-", "·")}</th>)}
              </tr></thead>
              <tbody>{monthly.stores.map((s) => (
                <tr key={s.store}>
                  <td style={td({ fontWeight: 560, position: "sticky", left: 0, background: "var(--surface)" })}>{s.store}</td>
                  {monthly.months.map((m) => {
                    const v = s.months[m];
                    const neg = v != null && v < 0;
                    return <td key={m} style={td({ ...rt, padding: "6px 6px", color: neg ? "var(--red)" : v != null ? "var(--ink)" : "var(--faint)", background: neg ? "var(--red-bg)" : "transparent" })}>{v == null ? "" : v.toFixed(0)}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </Card>
          <Note>Per-store monthly EBITDA (£'000) across 2026–2028. Red = a loss-making month.</Note>
        </>
      )}

      {tab === "bekpi" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>Group break-even · £'000</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 480 }}>
              <thead><tr><th style={th}>Line</th><th style={{ ...th, ...rt }}>2026</th><th style={{ ...th, ...rt }}>2027</th><th style={{ ...th, ...rt }}>2028</th></tr></thead>
              <tbody>{breakeven.map((r) => { const ratio = /%/.test(r.line_label); const f = (v) => (v == null ? "—" : ratio ? pctv(v) : k000(v));
                return <tr key={r.id}><td style={td({ fontWeight: 560 })}>{r.line_label}</td><td style={td(rt)}>{f(r.y2026)}</td><td style={td(rt)}>{f(r.y2027)}</td><td style={td(rt)}>{f(r.y2028)}</td></tr>; })}</tbody>
            </table>
          </Card>
          <Card>
            <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>Productivity · £ per retail sq ft</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 480 }}>
              <thead><tr><th style={th}>Metric</th><th style={{ ...th, ...rt }}>2026</th><th style={{ ...th, ...rt }}>2027</th><th style={{ ...th, ...rt }}>2028</th></tr></thead>
              <tbody>{kpi.map((r) => <tr key={r.id}><td style={td({ fontWeight: 560 })}>{r.metric}</td>
                <td style={td(rt)}>£{Number(r.y2026).toFixed(0)}</td><td style={td(rt)}>£{Number(r.y2027).toFixed(0)}</td><td style={td(rt)}>£{Number(r.y2028).toFixed(0)}</td></tr>)}</tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ children }) {
  return <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>{children}</div>;
}
function Note({ children }) {
  return <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>{children}</div>;
}
function WorkbookUpload({ setMsg, setErr }) {
  const router = useRouter();
  const ref = useRef(null);
  async function onFile(e) {
    setErr(""); setMsg("Reading workbook…");
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
      const d = await api({ action: "workbook", b64 });
      const s = d.summary || {};
      const loaded = Object.entries(s).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(" · ");
      setMsg(`Workbook loaded — ${loaded}.`); router.refresh();
    } catch (er) { setErr(er.message); }
    finally { if (ref.current) ref.current.value = ""; }
  }
  return (
    <label style={{ height: 34, padding: "0 16px", background: "var(--accent)", color: "#1a1813", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
      Upload workbook (.xlsx) — fills all tabs
      <input ref={ref} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ display: "none" }} />
    </label>
  );
}

function Upload({ dataset, label, setMsg, setErr }) {
  const router = useRouter();
  const ref = useRef(null);
  async function onFile(e) {
    setErr(""); setMsg("");
    const f = e.target.files?.[0]; if (!f) return;
    try { const r = await api({ action: "upload", dataset, csv: await f.text() }); setMsg(`${dataset}: loaded ${r.count} rows.`); router.refresh(); }
    catch (er) { setErr(er.message); }
    finally { if (ref.current) ref.current.value = ""; }
  }
  return (
    <label style={{ height: 32, padding: "0 12px", background: "transparent", color: "var(--muted)", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
      {label}
      <input ref={ref} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </label>
  );
}
