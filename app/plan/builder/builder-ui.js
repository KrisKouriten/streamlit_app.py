"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";
import PnlTable from "../pl-table";

/* Budget/Forecast Builder — store sales-driver entry. A row per month:
   footfall × conversion × ATV → calculated sales, ± a visible management
   adjustment → final sales (or a direct sales input). Save persists the driver
   rows; Compute runs the engine (sales + costs + payroll) into plan_line and the
   P&L below re-renders through the governed template. */

const METHODS = [
  { v: "CORE", label: "Core (footfall × conv × ATV)" },
  { v: "DIRECT", label: "Direct sales input" },
  { v: "HYBRID", label: "Hybrid (calc ± adjustment)" },
];

// Live preview of a row's sales (server is authoritative via buildStoreSales).
function previewSales(r) {
  const footfall = n(r.footfall), conv = n(r.conversionPct) / 100, atv = n(r.atv);
  const calculated = footfall * conv * atv;
  const adj = n(r.adjustment_amount);
  let final;
  if (r.method === "DIRECT") final = n(r.direct_sales);
  else if (r.method === "HYBRID") final = calculated + adj;
  else final = calculated;
  return { calculated, final };
}
const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

export default function BuilderUI({ versions, scenarios, stores, months, inputs, selected, pnl, canManage, createVersionAction }) {
  const router = useRouter();
  const nav = (patch) => {
    const p = new URLSearchParams();
    const next = { ...selected, ...patch };
    if (next.versionId) p.set("version", String(next.versionId));
    if (next.scenario) p.set("scenario", next.scenario);
    if (next.storeCode) p.set("store", next.storeCode);
    router.push(`/plan/builder?${p.toString()}`);
  };

  // Seed the editable grid from saved inputs (conversion fraction → % for display).
  const seed = () => {
    const byPeriod = Object.fromEntries(inputs.map((i) => [i.period, i]));
    return months.map((period) => {
      const i = byPeriod[period] || {};
      return {
        period,
        method: i.method || "CORE",
        footfall: i.footfall ?? "",
        conversionPct: i.conversion == null ? "" : +(Number(i.conversion) * 100).toFixed(4),
        atv: i.atv ?? "",
        direct_sales: i.direct_sales ?? "",
        adjustment_amount: i.adjustment_amount ?? "",
      };
    });
  };
  const [rows, setRows] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  if (!versions.length) {
    return (
      <div className="fos-card" style={{ padding: "20px 22px", maxWidth: 560 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 8 }}>Create a plan version to start</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
          A version is the container for a budget or forecast. Create one, choose a store, enter the sales drivers, then Compute.
          {" "}If this stays empty, the planning migrations (<span style={{ fontFamily: "var(--mono)" }}>055–060</span>) may not be applied.
        </div>
        {canManage ? <CreateVersionForm action={createVersionAction} /> : <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Ask a Finance admin to create the first plan version.</div>}
      </div>
    );
  }

  const setCell = (period, key, val) => setRows((rs) => rs.map((r) => (r.period === period ? { ...r, [key]: val } : r)));

  async function saveSales() {
    setBusy(true); setMsg(null);
    try {
      const payload = rows.map((r) => ({
        store_code: selected.storeCode, period: r.period, scope: "COMPANY_STORE", method: r.method,
        footfall: r.footfall, conversion: r.conversionPct === "" ? "" : Number(r.conversionPct) / 100,
        atv: r.atv, direct_sales: r.direct_sales, adjustment_amount: r.adjustment_amount,
      }));
      const res = await fetch("/api/plan/builder", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSales", versionId: selected.versionId, scenario: selected.scenario, rows: payload }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      setMsg(`Saved ${j.saved} month${j.saved === 1 ? "" : "s"}.`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function compute() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/plan/builder", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compute", versionId: selected.versionId, scenario: selected.scenario }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Compute failed");
      setMsg(`Computed — sales ${j.sales?.written ?? 0}, costs ${j.costs?.written ?? 0}, payroll ${j.payroll?.written ?? 0} lines.`);
      router.refresh();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const totals = rows.reduce((t, r) => { const p = previewSales(r); t.calc += p.calculated; t.final += p.final; return t; }, { calc: 0, final: 0 });

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
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
      </div>

      {stores.length === 0 ? (
        <div className="fos-card" style={{ padding: "16px 18px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          No company stores in the store master yet. Load the store list (store → entity) first — the sales-driver build is per store.
        </div>
      ) : (
        <>
          <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 14 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
              <thead><tr>
                {["Month", "Method", "Footfall", "Conv %", "ATV £", "Direct £", "Adj £", "Calculated", "Final"].map((h, i) => <th key={h} style={i === 0 ? thL : thR}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const pv = previewSales(r);
                  const core = r.method !== "DIRECT";
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

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            {canManage && <button className="fos-btn" disabled={busy} onClick={saveSales} style={{ padding: "8px 16px", fontSize: 13 }}>{busy ? "Working…" : "Save sales inputs"}</button>}
            {canManage && <button className="fos-btn-ghost" disabled={busy} onClick={compute} style={{ padding: "8px 16px", fontSize: 13 }}>Compute & refresh P&L</button>}
            {msg && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{msg}</span>}
            {!canManage && <span style={{ fontSize: 12.5, color: "var(--faint)" }}>Read-only — editing needs ADMIN or FINANCE.</span>}
          </div>

          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", margin: "6px 0 10px" }}>Computed store P&L</div>
          <PnlTable pnl={pnl} emptyHint="No computed lines for this store yet — enter sales drivers above and press Compute. Costs and payroll appear here too once their rules exist (entry screens are the next increment)." />
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

function Num({ value, on, disabled, step }) {
  return <input type="number" inputMode="decimal" step={step || "1"} value={value} disabled={disabled}
    onChange={(e) => on(e.target.value)} className="fos-input"
    style={{ width: 92, padding: "5px 7px", fontSize: 12, textAlign: "right", opacity: disabled ? 0.4 : 1 }} />;
}

function CreateVersionForm({ action }) {
  const [busy, setBusy] = useState(false);
  return (
    <form action={action} onSubmit={() => setBusy(true)} style={{ display: "grid", gap: 10 }}>
      <input name="label" required placeholder="Version label (e.g. FY2026 Budget v1)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13 }} />
      <div style={{ display: "flex", gap: 10 }}>
        <select name="kind" className="fos-input" style={{ ...sel, flex: 1 }} defaultValue="BUDGET">
          <option value="BUDGET">Budget</option>
          <option value="FORECAST">Forecast</option>
        </select>
        <input name="fiscal_year" type="number" placeholder="FY (e.g. 2026)" className="fos-input" style={{ padding: "8px 11px", fontSize: 13, width: 140 }} />
      </div>
      <button type="submit" className="fos-btn" disabled={busy} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>{busy ? "Creating…" : "Create version"}</button>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".06em", textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  );
}

const sel = { fontSize: 12.5, padding: "7px 10px" };
const cellSel = { fontSize: 11.5, padding: "4px 6px" };
const thL = { textAlign: "left", padding: "9px 12px 9px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const thR = { textAlign: "right", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdL = { textAlign: "left", padding: "5px 12px 5px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontFamily: "var(--mono)", fontSize: 12 };
const tdC = { padding: "4px 8px", borderBottom: "1px solid var(--hairline)", textAlign: "center" };
const tdR2 = { textAlign: "right", padding: "5px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", color: "var(--ink)" };
