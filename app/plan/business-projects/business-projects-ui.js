"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STATUSES, RAGS } from "../../../lib/business-projects-rules";

const gbp = (v) => (v == null ? "—" : `£${Math.round(Number(v)).toLocaleString()}`);
const RAG_COLOR = { green: "var(--green)", amber: "var(--amber, #b8860b)", red: "var(--red)" };
const monthLabel = (m) => { if (!m) return "—"; const [y, mo] = m.split("-"); return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo]} ${y.slice(2)}`; };

export default function BusinessProjectsUI({ projects, summary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", owner: "", status: "Planned", rag: "green", target_ym: "", budget: "", notes: "" });

  async function save(payload) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/business-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Save failed");
      router.refresh();
      return true;
    } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  }

  async function submitNew(e) {
    e.preventDefault();
    if (await save(form)) { setForm({ name: "", category: "", owner: "", status: "Planned", rag: "green", target_ym: "", budget: "", notes: "" }); setOpen(false); }
  }

  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r) => ({ textAlign: r ? "right" : "left", padding: "8px 12px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" });
  const input = { padding: "7px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[["Projects", summary.total], ["Active", summary.active], ["At risk (red)", summary.atRisk], ["Open budget", gbp(summary.budget)]].map(([k, v]) => (
          <div key={k} className="fos-card" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      <div>
        <button className="fos-btn" onClick={() => setOpen((o) => !o)} style={{ fontSize: 13 }}>{open ? "Cancel" : "+ New project"}</button>
        {err && <span style={{ color: "var(--red)", fontSize: 13, marginLeft: 12 }}>{err}</span>}
      </div>

      {open && (
        <form onSubmit={submitNew} className="fos-card" style={{ padding: "16px 18px", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Project name *</span><input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Category</span><input style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Owner</span><input style={input} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Status</span><select style={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>RAG</span><select style={input} value={form.rag} onChange={(e) => setForm({ ...form, rag: e.target.value })}>{RAGS.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Target (YYYY-MM)</span><input style={input} placeholder="2026-09" value={form.target_ym} onChange={(e) => setForm({ ...form, target_ym: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Budget £</span><input style={input} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Notes</span><input style={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ gridColumn: "1 / -1" }}><button className="fos-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save project"}</button></div>
        </form>
      )}

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 720, width: "100%" }}>
          <thead><tr>
            <th style={th(false)}>Project</th><th style={th(false)}>Category</th><th style={th(false)}>Owner</th>
            <th style={th(false)}>Status</th><th style={th(false)}>RAG</th><th style={th(false)}>Target</th><th style={th(true)}>Budget</th>
          </tr></thead>
          <tbody>
            {projects.length === 0 && <tr><td colSpan={7} style={{ ...td(false), color: "var(--faint)" }}>No projects yet — add the first one.</td></tr>}
            {projects.map((p) => (
              <tr key={p.id}>
                <td style={td(false)}><div style={{ fontWeight: 600 }}>{p.name}</div>{p.notes && <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "normal", maxWidth: 320 }}>{p.notes}</div>}</td>
                <td style={{ ...td(false), color: "var(--muted)" }}>{p.category || "—"}</td>
                <td style={{ ...td(false), color: "var(--muted)" }}>{p.owner || "—"}</td>
                <td style={td(false)}>
                  <select value={p.status} disabled={busy} onChange={(e) => save({ ...p, status: e.target.value })} style={{ ...input, padding: "4px 8px", fontSize: 12 }}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                </td>
                <td style={td(false)}><span style={{ color: RAG_COLOR[p.rag], fontWeight: 700 }}>●</span></td>
                <td style={{ ...td(false), fontFamily: "var(--mono)", color: "var(--muted)" }}>{monthLabel(p.target_ym)}</td>
                <td style={{ ...td(true), fontVariantNumeric: "tabular-nums" }}>{gbp(p.budget)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
