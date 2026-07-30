"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

/* Consolidated P&L — five scope columns through the governed template, plus the
   consolidation-adjustment register (draft → approved; only approved adjustments
   feed the Adjustments column). */

async function post(body) {
  const res = await fetch("/api/plan/consolidation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j;
}

export default function ConsolidatedUI({ versions, scenarios, selected, pnl, adjustments, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const nav = (patch) => {
    const p = new URLSearchParams();
    const next = { ...selected, ...patch };
    if (next.versionId) p.set("version", String(next.versionId));
    if (next.scenario) p.set("scenario", next.scenario);
    router.push(`/plan/consolidated?${p.toString()}`);
  };
  const run = async (fn) => { setBusy(true); setMsg(null); try { const m = await fn(); if (m) setMsg(m); router.refresh(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };

  if (!versions.length) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 560 }}>
      No plan version yet. Create one in the <a href="/plan/builder" style={{ color: "var(--accent)" }}>Budget / Forecast Builder</a>, enter drivers and Compute — the consolidated view assembles from the computed scopes.
    </div>;
  }

  const cols = pnl?.columns || [];

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
        {msg && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{msg}</span>}
      </div>

      {pnl?.unmapped?.length > 0 && (
        <div className="fos-card" style={{ padding: "12px 16px", marginBottom: 14, fontSize: 12.5, color: "var(--red)", lineHeight: 1.55 }}>
          <strong>{pnl.unmapped.length} unmapped</strong> nominal(s) excluded from the consolidated view: <span style={{ fontFamily: "var(--mono)" }}>{pnl.unmapped.join(", ")}</span>.
        </div>
      )}

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", marginBottom: 24 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
          <thead><tr>
            <th style={thL}>Consolidated P&L</th>
            {cols.map((c) => <th key={c.key} style={{ ...thR, ...(c.key === "CONSOLIDATED" ? { color: "var(--ink)" } : {}) }}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {(pnl?.rows || []).map((r, i) => <Row key={`${r.label}-${i}`} r={r} cols={cols} />)}
          </tbody>
        </table>
      </div>

      <AdjustmentsPanel adjustments={adjustments} selected={selected} canManage={canManage} run={run} busy={busy} />
    </>
  );
}

function Row({ r, cols }) {
  if (r.kind === "section" || r.kind === "sub") {
    return <tr><td colSpan={cols.length + 1} style={{ padding: r.kind === "section" ? "12px 12px 5px 16px" : "8px 12px 4px 24px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{r.label}</td></tr>;
  }
  const tone = r.tone === "ebitda" ? "ebitda" : (r.tone === "gp" ? "gp" : null);
  const fmt = (v) => r.isPct ? `${(v * 100).toFixed(1)}%` : (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  return (
    <tr>
      <td style={tdL(r.strong || !!r.tone)}>{r.label}</td>
      {cols.map((c) => {
        const v = r.cols?.[c.key];
        const strong = c.key === "CONSOLIDATED" || r.strong;
        const color = tone === "ebitda" ? (v >= 0 ? "var(--green)" : "var(--red)") : (tone === "gp" ? "var(--accent)" : (c.key === "ADJUSTMENTS" && v ? "var(--muted)" : undefined));
        return <td key={c.key} className="fos-num" style={tdR2({ strong, color })}>{fmt(v)}</td>;
      })}
    </tr>
  );
}

function AdjustmentsPanel({ adjustments, selected, canManage, run, busy }) {
  const blank = { kind: "IC_ELIMINATION", nominal: "", period: "", amount: "", reason: "" };
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const add = () => run(async () => { await post({ action: "saveAdjustment", versionId: selected.versionId, scenario: selected.scenario, adjustment: f }); setF(blank); return "Adjustment saved (draft)."; });
  const approve = (id, status) => run(async () => { await post({ action: "setApproval", adjId: id, status }); return `Adjustment ${status.toLowerCase()}.`; });
  const del = (id) => run(async () => { await post({ action: "deleteAdjustment", adjId: id }); return "Adjustment deleted."; });

  return (
    <>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", margin: "6px 0 10px" }}>Consolidation adjustments</div>
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 640, width: "100%" }}>
          <thead><tr>{["Kind", "Nominal", "Period", "Amount", "Reason", "Status", ""].map((h, i) => <th key={h} style={i === 0 ? thL : thR}>{h}</th>)}</tr></thead>
          <tbody>
            {adjustments.length === 0
              ? <tr><td colSpan={7} style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--muted)" }}>No adjustments. Only approved adjustments feed the Adjustments column.</td></tr>
              : adjustments.map((a) => (
                <tr key={a.adj_id}>
                  <td style={tdL(false)}>{a.kind}</td>
                  <td style={{ ...tdL(false), fontFamily: "var(--mono)" }}>{a.nominal}</td>
                  <td style={tdMid}>{a.period}</td>
                  <td className="fos-num" style={tdR2({})}>{money(Number(a.amount), { compact: true })}</td>
                  <td style={{ ...tdMid, whiteSpace: "normal", maxWidth: 260 }}>{a.reason}</td>
                  <td style={tdMid}><span style={{ fontSize: 11, fontWeight: 600, color: a.status === "APPROVED" ? "var(--green)" : "var(--faint)" }}>{a.status}</span></td>
                  <td style={{ ...tdMid, textAlign: "right" }}>
                    {canManage && (a.status === "DRAFT"
                      ? <><button className="fos-btn-ghost" disabled={busy} onClick={() => approve(a.adj_id, "APPROVED")} style={miniBtn}>Approve</button> <button className="fos-btn-ghost" disabled={busy} onClick={() => del(a.adj_id)} style={miniBtn}>Delete</button></>
                      : <button className="fos-btn-ghost" disabled={busy} onClick={() => approve(a.adj_id, "DRAFT")} style={miniBtn}>Unapprove</button>)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="fos-card" style={{ padding: "14px 16px", marginTop: 12, display: "grid", gap: 10, maxWidth: 860 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Kind"><select className="fos-input" value={f.kind} onChange={(e) => set("kind", e.target.value)} style={sel}>{["IC_ELIMINATION", "RECLASS", "ALLOCATION", "MANAGEMENT", "OTHER"].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
            <Field label="Nominal"><input className="fos-input" value={f.nominal} onChange={(e) => set("nominal", e.target.value)} placeholder="e.g. ST: Sales" style={{ ...sel, width: 180 }} /></Field>
            <Field label="Period"><input className="fos-input" value={f.period} onChange={(e) => set("period", e.target.value)} placeholder="YYYY-MM" style={{ ...sel, width: 100 }} /></Field>
            <Field label="Amount £"><input type="number" className="fos-input" value={f.amount} onChange={(e) => set("amount", e.target.value)} style={{ ...sel, width: 120, textAlign: "right" }} /></Field>
            <Field label="Reason"><input className="fos-input" value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Documented reason (required)" style={{ ...sel, width: 260 }} /></Field>
          </div>
          <button className="fos-btn" disabled={busy} onClick={add} style={{ justifySelf: "start", padding: "8px 16px", fontSize: 13 }}>Add adjustment</button>
        </div>
      )}
    </>
  );
}

function Field({ label, children }) {
  return <label style={{ display: "inline-flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".06em", textTransform: "uppercase" }}>{label}{children}</label>;
}

const sel = { fontSize: 12.5, padding: "7px 10px" };
const miniBtn = { padding: "3px 9px", fontSize: 11.5 };
const thL = { textAlign: "left", padding: "9px 12px 9px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--surface)" };
const thR = { textAlign: "right", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdL = (strong) => ({ textAlign: "left", padding: "7px 12px 7px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: "var(--ink)", position: "sticky", left: 0, background: "var(--surface)" });
const tdMid = { padding: "7px 12px", borderBottom: "1px solid var(--hairline)", fontSize: 12, color: "var(--ink)", whiteSpace: "nowrap" };
const tdR2 = ({ strong, color } = {}) => ({ textAlign: "right", padding: "7px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: color || "var(--ink)" });
