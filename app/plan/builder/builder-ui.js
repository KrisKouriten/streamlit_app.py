"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";
import PnlTable from "../pl-table";

/* Budget/Forecast Builder — driver entry over the planning engine.
   Tabs: Sales (footfall × conv × ATV ± adjustment), Costs (fixed / % of sales),
   Payroll (basic → holiday → pension → NI), P&L (getScopePL through the governed
   template). Save persists the rule/inputs; Compute runs the engine into plan_line
   and the P&L re-renders. One screen for both budget and forecast (version kind). */

const METHODS = [
  { v: "CORE", label: "Core (footfall × conv × ATV)" },
  { v: "DIRECT", label: "Direct sales input" },
  { v: "HYBRID", label: "Hybrid (calc ± adjustment)" },
];
const TABS = ["Sales", "Costs", "Payroll", "P&L"];

const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
function previewSales(r) {
  const calculated = n(r.footfall) * (n(r.conversionPct) / 100) * n(r.atv);
  const final = r.method === "DIRECT" ? n(r.direct_sales) : (r.method === "HYBRID" ? calculated + n(r.adjustment_amount) : calculated);
  return { calculated, final };
}

async function post(body) {
  const res = await fetch("/api/plan/builder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}

export default function BuilderUI({ versions, scenarios, stores, months, inputs, costRules, payrollRules, costNominals, selected, pnl, canManage, createVersionAction }) {
  const router = useRouter();
  const [tab, setTab] = useState("Sales");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const nav = (patch) => {
    const p = new URLSearchParams();
    const next = { ...selected, ...patch };
    if (next.versionId) p.set("version", String(next.versionId));
    if (next.scenario) p.set("scenario", next.scenario);
    if (next.storeCode) p.set("store", next.storeCode);
    router.push(`/plan/builder?${p.toString()}`);
  };

  if (!versions.length) {
    return (
      <div className="fos-card" style={{ padding: "20px 22px", maxWidth: 560 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 8 }}>Create a plan version to start</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
          A version is the container for a budget or forecast. Create one, choose a store, enter drivers, then Compute.
          {" "}If this stays empty, the planning migrations (<span style={{ fontFamily: "var(--mono)" }}>055–060</span>) may not be applied.
        </div>
        {canManage ? <CreateVersionForm action={createVersionAction} /> : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Ask a Finance admin to create the first plan version.</div>}
      </div>
    );
  }

  const run = async (fn) => { setBusy(true); setMsg(null); try { const m = await fn(); if (m) setMsg(m); router.refresh(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const compute = () => run(async () => {
    const j = await post({ action: "compute", versionId: selected.versionId, scenario: selected.scenario });
    return `Computed — sales ${j.sales?.written ?? 0}, costs ${j.costs?.written ?? 0}, payroll ${j.payroll?.written ?? 0} lines.`;
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Field label="Version">
          <select className="fos-input" value={selected.versionId ?? ""} onChange={(e) => nav({ versionId: Number(e.target.value) })} style={sel}>
            {versions.map((v) => <option key={v.version_id} value={v.version_id}>{v.kind} · {v.label}{v.fiscal_year ? ` · FY${v.fiscal_year}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Scenario">
          <select className="fos-input" value={selected.scenario} onChange={(e) => nav({ scenario: e.target.value })} style={sel}>
            {scenarios.map((s) => <option key={s.scenario_code} value={s.scenario_code}>{s.name || s.scenario_code}</option>)}
          </select>
        </Field>
        <Field label="Store">
          <select className="fos-input" value={selected.storeCode ?? ""} onChange={(e) => nav({ storeCode: e.target.value })} style={sel}>
            {stores.length === 0 && <option value="">No stores loaded</option>}
            {stores.map((s) => <option key={s.store_code} value={s.store_code}>{s.store_code} — {s.store_name}</option>)}
          </select>
        </Field>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {msg && <span style={{ fontSize: 12, color: "var(--muted)" }}>{msg}</span>}
          {canManage && selected.storeCode && <button className="fos-btn" disabled={busy} onClick={compute} style={{ padding: "8px 16px", fontSize: 13 }}>{busy ? "Working…" : "Compute & refresh"}</button>}
        </div>
      </div>

      {stores.length === 0 ? (
        <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          No company stores in the store master yet. Load the store list (store → entity) first — planning is per store.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t}</button>
            ))}
          </div>

          {tab === "Sales" && <SalesPanel months={months} inputs={inputs} selected={selected} canManage={canManage} onSaved={setMsg} refresh={() => router.refresh()} />}
          {tab === "Costs" && <CostsPanel rules={costRules} costNominals={costNominals} months={months} selected={selected} canManage={canManage} run={run} />}
          {tab === "Payroll" && <PayrollPanel rules={payrollRules} months={months} selected={selected} canManage={canManage} run={run} />}
          {tab === "P&L" && <PnlTable pnl={pnl} emptyHint="No computed lines yet — enter drivers on the other tabs and press Compute." />}
        </>
      )}

      {canManage && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ fontSize: 12.5, color: "var(--faint)", cursor: "pointer" }}>New plan version</summary>
          <div style={{ marginTop: 12, maxWidth: 480 }}><CreateVersionForm action={createVersionAction} /></div>
        </details>
      )}
    </>
  );
}

// ---- Sales tab ----------------------------------------------------------
function SalesPanel({ months, inputs, selected, canManage, onSaved, refresh }) {
  const seed = () => {
    const byPeriod = Object.fromEntries(inputs.map((i) => [i.period, i]));
    return months.map((period) => {
      const i = byPeriod[period] || {};
      return { period, method: i.method || "CORE", footfall: i.footfall ?? "", conversionPct: i.conversion == null ? "" : +(Number(i.conversion) * 100).toFixed(4), atv: i.atv ?? "", direct_sales: i.direct_sales ?? "", adjustment_amount: i.adjustment_amount ?? "" };
    });
  };
  const [rows, setRows] = useState(seed);
  const [busy, setBusy] = useState(false);
  const setCell = (period, key, val) => setRows((rs) => rs.map((r) => (r.period === period ? { ...r, [key]: val } : r)));

  async function save() {
    setBusy(true);
    try {
      const payload = rows.map((r) => ({ store_code: selected.storeCode, period: r.period, scope: "COMPANY_STORE", method: r.method, footfall: r.footfall, conversion: r.conversionPct === "" ? "" : Number(r.conversionPct) / 100, atv: r.atv, direct_sales: r.direct_sales, adjustment_amount: r.adjustment_amount }));
      const j = await post({ action: "saveSales", versionId: selected.versionId, scenario: selected.scenario, rows: payload });
      onSaved(`Saved ${j.saved} month${j.saved === 1 ? "" : "s"}.`); refresh();
    } catch (e) { onSaved(e.message); } finally { setBusy(false); }
  }
  const totals = rows.reduce((t, r) => { const p = previewSales(r); t.calc += p.calculated; t.final += p.final; return t; }, { calc: 0, final: 0 });

  return (
    <>
      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 14 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
          <thead><tr>{["Month", "Method", "Footfall", "Conv %", "ATV £", "Direct £", "Adj £", "Calculated", "Final"].map((h, i) => <th key={h} style={i === 0 ? thL : thR}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const pv = previewSales(r); const core = r.method !== "DIRECT";
              return (
                <tr key={r.period}>
                  <td style={tdL}>{r.period}</td>
                  <td style={tdC}><select className="fos-input" value={r.method} onChange={(e) => setCell(r.period, "method", e.target.value)} style={cellSel}>{METHODS.map((m) => <option key={m.v} value={m.v}>{m.v}</option>)}</select></td>
                  <td style={tdC}><Num value={r.footfall} on={(v) => setCell(r.period, "footfall", v)} disabled={!core} /></td>
                  <td style={tdC}><Num value={r.conversionPct} on={(v) => setCell(r.period, "conversionPct", v)} disabled={!core} step="0.1" /></td>
                  <td style={tdC}><Num value={r.atv} on={(v) => setCell(r.period, "atv", v)} disabled={!core} step="0.01" /></td>
                  <td style={tdC}><Num value={r.direct_sales} on={(v) => setCell(r.period, "direct_sales", v)} disabled={r.method !== "DIRECT"} /></td>
                  <td style={tdC}><Num value={r.adjustment_amount} on={(v) => setCell(r.period, "adjustment_amount", v)} disabled={r.method !== "HYBRID"} /></td>
                  <td className="fos-num" style={tdR2}>{pv.calculated ? money(pv.calculated, { compact: true }) : "·"}</td>
                  <td className="fos-num" style={{ ...tdR2, fontWeight: 650 }}>{pv.final ? money(pv.final, { compact: true }) : "·"}</td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...tdL, fontWeight: 650, borderTop: "1px solid var(--line)" }}>Year</td>
              <td colSpan={6} style={{ borderTop: "1px solid var(--line)" }} />
              <td className="fos-num" style={{ ...tdR2, fontWeight: 650, borderTop: "1px solid var(--line)" }}>{money(totals.calc, { compact: true })}</td>
              <td className="fos-num" style={{ ...tdR2, fontWeight: 650, borderTop: "1px solid var(--line)" }}>{money(totals.final, { compact: true })}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {canManage
        ? <button className="fos-btn" disabled={busy} onClick={save} style={{ padding: "8px 16px", fontSize: 13 }}>{busy ? "Saving…" : "Save sales inputs"}</button>
        : <span style={{ fontSize: 12.5, color: "var(--faint)" }}>Read-only — editing needs ADMIN or FINANCE.</span>}
    </>
  );
}

// ---- Costs tab ----------------------------------------------------------
function CostsPanel({ rules, costNominals, months, selected, canManage, run }) {
  const blank = { nominal: costNominals[0] || "", behaviour: "FIXED_MONTHLY", monthly_amount: "", rate: "", sales_base: "ST: Sales", start_period: months[0], end_period: months[months.length - 1] };
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const add = () => run(async () => { await post({ action: "saveCostRule", versionId: selected.versionId, scenario: selected.scenario, rule: { ...f, store_code: selected.storeCode, scope: "COMPANY_STORE" } }); setF(blank); return "Cost rule saved."; });
  const del = (id) => run(async () => { await post({ action: "deleteCostRule", versionId: selected.versionId, ruleId: id }); return "Cost rule deleted."; });

  return (
    <>
      <RuleTable
        head={["Nominal", "Behaviour", "Amount / Rate", "Period", ""]}
        rows={rules.map((r) => [
          r.nominal,
          r.behaviour === "PCT_OF_SALES" ? "% of sales" : "Fixed monthly",
          r.behaviour === "PCT_OF_SALES" ? `${(Number(r.rate) * 100).toFixed(2)}% × ${r.sales_base}` : money(Number(r.monthly_amount), { compact: true }) + "/mo",
          r.behaviour === "PCT_OF_SALES" ? "—" : `${r.start_period} → ${r.end_period}`,
          canManage ? <button className="fos-btn-ghost" onClick={() => del(r.rule_id)} style={delBtn}>Delete</button> : null,
        ])}
        empty="No cost rules for this store yet."
      />
      {canManage && (
        <div className="fos-card" style={{ padding: "14px 16px", marginTop: 12, display: "grid", gap: 10, maxWidth: 720 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Nominal"><select className="fos-input" value={f.nominal} onChange={(e) => set("nominal", e.target.value)} style={{ ...sel, minWidth: 200 }}>{costNominals.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Behaviour"><select className="fos-input" value={f.behaviour} onChange={(e) => set("behaviour", e.target.value)} style={sel}><option value="FIXED_MONTHLY">Fixed monthly</option><option value="PCT_OF_SALES">% of sales</option></select></Field>
            {f.behaviour === "FIXED_MONTHLY" ? (
              <>
                <Field label="Monthly £"><Num value={f.monthly_amount} on={(v) => set("monthly_amount", v)} /></Field>
                <Field label="From"><select className="fos-input" value={f.start_period} onChange={(e) => set("start_period", e.target.value)} style={sel}>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
                <Field label="To"><select className="fos-input" value={f.end_period} onChange={(e) => set("end_period", e.target.value)} style={sel}>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
              </>
            ) : (
              <>
                <Field label="Rate %"><Num value={f.rate} on={(v) => set("rate", v)} step="0.01" /></Field>
                <Field label="Sales base"><input className="fos-input" value={f.sales_base} onChange={(e) => set("sales_base", e.target.value)} style={{ ...sel, width: 140 }} /></Field>
              </>
            )}
          </div>
          <button className="fos-btn" onClick={add} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>Add cost rule</button>
        </div>
      )}
    </>
  );
}

// ---- Payroll tab --------------------------------------------------------
function PayrollPanel({ rules, months, selected, canManage, run }) {
  const blank = { monthly_basic: "", start_period: months[0], end_period: months[months.length - 1], holiday_pct: "12.07", pension_pct: "3", er_ni_pct: "13.8", ni_threshold_monthly: "" };
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const add = () => run(async () => { await post({ action: "savePayrollRule", versionId: selected.versionId, scenario: selected.scenario, rule: { ...f, store_code: selected.storeCode, scope: "COMPANY_STORE" } }); setF(blank); return "Payroll rule saved."; });
  const del = (id) => run(async () => { await post({ action: "deletePayrollRule", versionId: selected.versionId, ruleId: id }); return "Payroll rule deleted."; });
  const p = (v) => v == null ? "—" : `${(Number(v) * 100).toFixed(2)}%`;

  return (
    <>
      <RuleTable
        head={["Monthly basic", "Period", "Holiday", "Pension", "Er NI", "NI threshold", ""]}
        rows={rules.map((r) => [
          money(Number(r.monthly_basic), { compact: true }),
          `${r.start_period} → ${r.end_period}`,
          p(r.holiday_pct), p(r.pension_pct), p(r.er_ni_pct),
          r.ni_threshold_monthly ? money(Number(r.ni_threshold_monthly), { compact: true }) : "—",
          canManage ? <button className="fos-btn-ghost" onClick={() => del(r.rule_id)} style={delBtn}>Delete</button> : null,
        ])}
        empty="No payroll rules for this store yet. Blank rates fall back to the Assumption Register (holiday 12.07%, pension 3%, NI configurable)."
      />
      {canManage && (
        <div className="fos-card" style={{ padding: "14px 16px", marginTop: 12, display: "grid", gap: 10, maxWidth: 760 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Monthly basic £"><Num value={f.monthly_basic} on={(v) => set("monthly_basic", v)} /></Field>
            <Field label="From"><select className="fos-input" value={f.start_period} onChange={(e) => set("start_period", e.target.value)} style={sel}>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
            <Field label="To"><select className="fos-input" value={f.end_period} onChange={(e) => set("end_period", e.target.value)} style={sel}>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
            <Field label="Holiday %"><Num value={f.holiday_pct} on={(v) => set("holiday_pct", v)} step="0.01" /></Field>
            <Field label="Pension %"><Num value={f.pension_pct} on={(v) => set("pension_pct", v)} step="0.01" /></Field>
            <Field label="Er NI %"><Num value={f.er_ni_pct} on={(v) => set("er_ni_pct", v)} step="0.01" /></Field>
            <Field label="NI threshold £/mo"><Num value={f.ni_threshold_monthly} on={(v) => set("ni_threshold_monthly", v)} /></Field>
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.5 }}>Chain: holiday = basic × %, pension &amp; NI = (basic + holiday) × %. Components post to the store template's staff-cost nominals.</div>
          <button className="fos-btn" onClick={add} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>Add payroll rule</button>
        </div>
      )}
    </>
  );
}

function RuleTable({ head, rows, empty }) {
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 560, width: "100%" }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={i === 0 ? thL : thR}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={head.length} style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--muted)" }}>{empty}</td></tr>
            : rows.map((cells, ri) => <tr key={ri}>{cells.map((c, ci) => <td key={ci} className={ci > 0 && ci < cells.length - 1 ? "fos-num" : undefined} style={ci === 0 ? tdL : (ci === cells.length - 1 ? { ...tdR2, textAlign: "right" } : tdR2)}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Num({ value, on, disabled, step }) {
  return <input type="number" inputMode="decimal" step={step || "1"} value={value} disabled={disabled} onChange={(e) => on(e.target.value)} className="fos-input" style={{ width: 100, padding: "5px 7px", fontSize: 12, textAlign: "right", opacity: disabled ? 0.4 : 1 }} />;
}

function CreateVersionForm({ action }) {
  const [busy, setBusy] = useState(false);
  return (
    <form action={action} onSubmit={() => setBusy(true)} style={{ display: "grid", gap: 10 }}>
      <input name="label" required placeholder="Version label (e.g. FY2026 Budget v1)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13 }} />
      <div style={{ display: "flex", gap: 10 }}>
        <select name="kind" className="fos-input" style={{ ...sel, flex: 1 }} defaultValue="BUDGET"><option value="BUDGET">Budget</option><option value="FORECAST">Forecast</option></select>
        <input name="fiscal_year" type="number" placeholder="FY (e.g. 2026)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13, width: 140 }} />
      </div>
      <button type="submit" className="fos-btn" disabled={busy} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>{busy ? "Creating…" : "Create version"}</button>
    </form>
  );
}

function Field({ label, children }) {
  return <label style={{ display: "inline-flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".06em", textTransform: "uppercase" }}>{label}{children}</label>;
}

const sel = { fontSize: 12.5, padding: "7px 10px" };
const cellSel = { fontSize: 11.5, padding: "4px 6px" };
const tabBtn = (on) => ({ padding: "8px 14px", fontSize: 13, fontWeight: on ? 650 : 500, color: on ? "var(--ink)" : "var(--faint)", background: "none", border: "none", borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer" });
const delBtn = { padding: "3px 9px", fontSize: 11.5 };
const thL = { textAlign: "left", padding: "9px 12px 9px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const thR = { textAlign: "right", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdL = { textAlign: "left", padding: "6px 12px 6px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontFamily: "var(--mono)", fontSize: 12 };
const tdC = { padding: "4px 8px", borderBottom: "1px solid var(--hairline)", textAlign: "center" };
const tdR2 = { textAlign: "right", padding: "6px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", color: "var(--ink)" };
