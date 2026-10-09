"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUSES, projectDeleteError, projectDateLabel } from "../../../lib/business-projects-rules";
import ProjectForm from "./project-form";

const gbp = (v) => (v == null ? "—" : `£${Math.round(Number(v)).toLocaleString("en-GB")}`);
const RAG_COLOR = { green: "var(--green)", amber: "var(--amber, #b8860b)", red: "var(--red)" };

/* Business Projects register — client. The KPI row, a roomy "New project" form
   (project-form.js, shared with the project page), and the register itself:
   status changed in place, dates, budget, and a Delete per project for whoever
   set it up or Finance. A project with P.Os or departmental budgets against it
   can't be deleted (projectDeleteError) — the button says why. */
export default function BusinessProjectsUI({ projects, summary, me = null, canManage = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false);

  async function post(payload, note) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/business-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Save failed");
      if (note) setMsg(note);
      router.refresh();
      return true;
    } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  }

  async function create(payload) {
    if (await post(payload, `“${payload.name}” added.`)) setOpen(false);
  }

  function remove(p) {
    const costNote = "Its planned cost lines will be deleted with it.";
    if (!window.confirm(`Delete the project “${p.name}”? ${costNote} This can't be undone.`)) return;
    post({ op: "delete", id: p.id }, `“${p.name}” deleted.`);
  }

  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "11px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r) => ({ textAlign: r ? "right" : "left", padding: "12px 14px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap", verticalAlign: "top" });
  const selectSt = { padding: "5px 8px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" };

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {[["Projects", summary.total], ["Active", summary.active], ["At risk (red)", summary.atRisk], ["Open budget", gbp(summary.budget)]].map(([k, v]) => (
          <div key={k} className="fos-card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{k}</div>
            <div style={{ fontSize: 21, fontWeight: 700, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      {open ? (
        <ProjectForm title="New business project" submitLabel="Save project" busy={busy} error={err}
          onSubmit={create} onCancel={() => { setOpen(false); setErr(null); }} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="fos-btn" onClick={() => { setOpen(true); setErr(null); setMsg(null); }} style={{ fontSize: 13 }}>+ New project</button>
          {msg && <span style={{ color: "var(--green)", fontSize: 13 }}>{msg}</span>}
          {err && <span style={{ color: "var(--red)", fontSize: 13 }}>{err}</span>}
        </div>
      )}

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 980, width: "100%" }}>
          <thead><tr>
            <th style={th(false)}>Project</th><th style={th(false)}>Category</th><th style={th(false)}>Owner</th>
            <th style={th(false)}>Status</th><th style={th(false)}>RAG</th>
            <th style={th(false)}>Planned start</th><th style={th(false)}>Target finish</th>
            <th style={th(true)}>Budget</th><th style={th(true)} aria-label="Actions" />
          </tr></thead>
          <tbody>
            {projects.length === 0 && <tr><td colSpan={9} style={{ ...td(false), color: "var(--faint)" }}>No projects yet — add the first one.</td></tr>}
            {projects.map((p) => {
              const blocked = projectDeleteError(p, p.links || {}, { actor: me, canManage });
              return (
                <tr key={p.id}>
                  <td style={{ ...td(false), whiteSpace: "normal", minWidth: 220, maxWidth: 360 }}>
                    <div style={{ fontWeight: 600 }}><Link href={`/plan/business-projects/${p.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{p.name}</Link></div>
                    {p.notes && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>{p.notes}</div>}
                  </td>
                  <td style={{ ...td(false), color: "var(--muted)" }}>{p.category || "—"}</td>
                  <td style={{ ...td(false), color: "var(--muted)" }}>{p.owner || "—"}</td>
                  <td style={td(false)}>
                    <select aria-label={`Status of ${p.name}`} value={p.status} disabled={busy} onChange={(e) => post({ ...p, status: e.target.value }, `“${p.name}” is now ${e.target.value}.`)} style={selectSt}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                  </td>
                  <td style={td(false)}><span title={`RAG: ${p.rag}`} style={{ color: RAG_COLOR[p.rag], fontWeight: 700 }}>●</span></td>
                  <td style={{ ...td(false), color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{projectDateLabel(p.start_date)}</td>
                  <td style={{ ...td(false), color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{projectDateLabel(p.target_date, p.target_ym)}</td>
                  <td style={{ ...td(true), fontVariantNumeric: "tabular-nums" }}>{gbp(p.budget)}</td>
                  <td style={td(true)}>
                    <button type="button" onClick={() => remove(p)} disabled={busy || !!blocked} title={blocked || `Delete ${p.name}`}
                      style={{ fontSize: 12, fontWeight: 600, padding: "4px 11px", borderRadius: 7, cursor: blocked ? "not-allowed" : "pointer", background: "transparent",
                        border: `1px solid ${blocked ? "var(--line)" : "color-mix(in srgb, var(--red) 45%, var(--line))"}`, color: blocked ? "var(--faint)" : "var(--red)" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {projects.some((p) => projectDeleteError(p, p.links || {}, { actor: me, canManage })) && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: -10 }}>
          A greyed-out Delete means the project can&rsquo;t be removed yet — hover it to see why (P.Os or budgets still point at it, or it was set up by someone else).
        </div>
      )}
    </div>
  );
}
