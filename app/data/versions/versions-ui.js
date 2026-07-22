"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const gbp = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}£${Math.abs(Math.round(Number(v))).toLocaleString()}`);
const when = (t) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const KIND_LABEL = { BUDGET: "Budget", FORECAST: "Forecast" };
const STATUS_STYLE = {
  DRAFT: { color: "var(--muted)", border: "var(--line)" },
  APPROVED: { color: "var(--green)", border: "color-mix(in srgb, var(--green) 45%, transparent)" },
  ARCHIVED: { color: "var(--faint)", border: "var(--line)" },
};

export default function VersionsUI({ versions, initialKind, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [kind, setKind] = useState(initialKind || "ALL");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", kind: initialKind || "BUDGET", fiscalYear: "", notes: "" });

  const [cmp, setCmp] = useState({ a: "", b: "" });
  const [diff, setDiff] = useState(null);

  const shown = useMemo(
    () => (kind === "ALL" ? versions : versions.filter((v) => v.kind === kind)),
    [versions, kind]
  );

  async function post(payload) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/forecast-versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      router.refresh();
      return j;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }

  async function submitNew(e) {
    e.preventDefault();
    const r = await post({ action: "create", ...form });
    if (r) { setForm({ label: "", kind: form.kind, fiscalYear: "", notes: "" }); setOpen(false); }
  }

  async function runCompare() {
    if (!cmp.a || !cmp.b || cmp.a === cmp.b) { setErr("Pick two different versions to compare"); return; }
    setBusy(true); setErr(null); setDiff(null);
    try {
      const res = await fetch(`/api/forecast-versions?a=${cmp.a}&b=${cmp.b}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Compare failed");
      setDiff(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const th = (r) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
  const td = (r) => ({ textAlign: r ? "right" : "left", padding: "8px 12px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" });
  const input = { padding: "7px 10px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" };
  const tab = (active) => ({ padding: "5px 12px", fontSize: 12.5, borderRadius: 999, cursor: "pointer", border: `1px solid ${active ? "var(--accent-deep)" : "var(--line)"}`, background: active ? "var(--accent-bg)" : "transparent", color: active ? "var(--accent)" : "var(--muted)" });
  const badge = (status) => ({ fontSize: 10.5, fontFamily: "var(--mono)", letterSpacing: ".05em", padding: "2px 7px", borderRadius: 999, border: `1px solid ${STATUS_STYLE[status].border}`, color: STATUS_STYLE[status].color });

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, maxWidth: 760, margin: 0 }}>
        A version is a frozen snapshot of the working forecast (PLAN → Forecast Builder), captured and labelled so it never changes again. Approve a snapshot as a <strong>budget</strong> and the Management Accounts dashboard compares actuals against it. Take a <strong>forecast</strong> version at each re-forecast to keep an audit trail of how the view moved.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["ALL", "BUDGET", "FORECAST"].map((k) => (
          <span key={k} onClick={() => setKind(k)} style={tab(kind === k)}>{k === "ALL" ? "All" : KIND_LABEL[k]}</span>
        ))}
        {canManage && (
          <button className="fos-btn" onClick={() => setOpen((o) => !o)} style={{ fontSize: 13, marginLeft: "auto" }}>{open ? "Cancel" : "+ Snapshot current forecast"}</button>
        )}
      </div>
      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}

      {open && canManage && (
        <form onSubmit={submitNew} className="fos-card" style={{ padding: "16px 18px", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Label *</span><input style={input} placeholder="FY26 Budget" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required /></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Kind</span><select style={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="BUDGET">Budget</option><option value="FORECAST">Forecast</option></select></label>
          <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Fiscal year</span><input style={input} placeholder="2026" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}><span style={{ fontSize: 11.5, color: "var(--faint)" }}>Notes</span><input style={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ gridColumn: "1 / -1" }}><button className="fos-btn" type="submit" disabled={busy}>{busy ? "Capturing…" : "Capture snapshot"}</button></div>
        </form>
      )}

      <div className="fos-card fos-tbl" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 760, width: "100%" }}>
          <thead><tr>
            <th style={th(false)}>Label</th><th style={th(false)}>Kind</th><th style={th(false)}>Status</th>
            <th style={th(false)}>FY</th><th style={th(true)}>Lines</th><th style={th(false)}>Created</th>
            <th style={th(false)}>Approved</th>{canManage && <th style={th(true)}>Actions</th>}
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={canManage ? 8 : 7} style={{ ...td(false), color: "var(--faint)" }}>No versions yet{canManage ? " — snapshot the current forecast to create one." : "."}</td></tr>}
            {shown.map((v) => (
              <tr key={v.version_id}>
                <td style={td(false)}><div style={{ fontWeight: 600 }}>{v.label}</div>{v.notes && <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "normal", maxWidth: 320 }}>{v.notes}</div>}</td>
                <td style={{ ...td(false), color: "var(--muted)" }}>{KIND_LABEL[v.kind]}</td>
                <td style={td(false)}><span style={badge(v.status)}>{v.status}</span></td>
                <td style={{ ...td(false), fontFamily: "var(--mono)", color: "var(--muted)" }}>{v.fiscal_year || "—"}</td>
                <td style={{ ...td(true), fontVariantNumeric: "tabular-nums" }}>{Number(v.line_count).toLocaleString()}</td>
                <td style={{ ...td(false), color: "var(--muted)" }}>{when(v.created_at)}<div style={{ fontSize: 11, color: "var(--faint)" }}>{v.created_by}</div></td>
                <td style={{ ...td(false), color: "var(--muted)" }}>{v.approved_at ? when(v.approved_at) : "—"}{v.approved_by && <div style={{ fontSize: 11, color: "var(--faint)" }}>{v.approved_by}</div>}</td>
                {canManage && (
                  <td style={{ ...td(true), whiteSpace: "nowrap" }}>
                    {v.status === "DRAFT" && <button disabled={busy} onClick={() => post({ action: "approve", versionId: v.version_id })} style={{ ...input, padding: "4px 9px", fontSize: 11.5, marginLeft: 6, cursor: "pointer" }}>Approve</button>}
                    {v.status !== "ARCHIVED" && <button disabled={busy} onClick={() => post({ action: "archive", versionId: v.version_id })} style={{ ...input, padding: "4px 9px", fontSize: 11.5, marginLeft: 6, cursor: "pointer" }}>Archive</button>}
                    {v.status === "DRAFT" && <button disabled={busy} onClick={() => { if (confirm(`Delete draft “${v.label}”? This cannot be undone.`)) post({ action: "delete", versionId: v.version_id }); }} style={{ ...input, padding: "4px 9px", fontSize: 11.5, marginLeft: 6, cursor: "pointer", color: "var(--red)" }}>Delete</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Compare two versions */}
      <div className="fos-card" style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 650 }}>Compare two versions</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: e.target.value })}>
            <option value="">From…</option>
            {versions.map((v) => <option key={v.version_id} value={v.version_id}>{v.label} ({KIND_LABEL[v.kind]})</option>)}
          </select>
          <span style={{ color: "var(--faint)" }}>→</span>
          <select style={input} value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: e.target.value })}>
            <option value="">To…</option>
            {versions.map((v) => <option key={v.version_id} value={v.version_id}>{v.label} ({KIND_LABEL[v.kind]})</option>)}
          </select>
          <button className="fos-btn" disabled={busy} onClick={runCompare} style={{ fontSize: 13 }}>{busy ? "Comparing…" : "Compare"}</button>
        </div>

        {diff && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)" }}>
              <span><strong style={{ color: "var(--ink)" }}>{diff.summary.changed}</strong> changed</span>
              <span><strong style={{ color: "var(--ink)" }}>{diff.summary.added}</strong> added</span>
              <span><strong style={{ color: "var(--ink)" }}>{diff.summary.removed}</strong> removed</span>
              <span><strong style={{ color: "var(--ink)" }}>{diff.summary.unchanged}</strong> unchanged</span>
              <span>Net change <strong style={{ color: diff.summary.deltaValue >= 0 ? "var(--green)" : "var(--red)" }}>{gbp(diff.summary.deltaValue)}</strong></span>
            </div>
            {diff.rows.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 640, width: "100%" }}>
                  <thead><tr>
                    <th style={th(false)}>Scope</th><th style={th(false)}>Unit</th><th style={th(false)}>Line</th><th style={th(false)}>Month</th>
                    <th style={th(true)}>{diff.a.label}</th><th style={th(true)}>{diff.b.label}</th><th style={th(true)}>Δ</th>
                  </tr></thead>
                  <tbody>
                    {diff.rows.slice(0, 100).map((r) => (
                      <tr key={r.key}>
                        <td style={{ ...td(false), color: "var(--muted)" }}>{r.scope}</td>
                        <td style={{ ...td(false), color: "var(--muted)" }}>{r.unit || "—"}</td>
                        <td style={td(false)}>{r.line_label}</td>
                        <td style={{ ...td(false), fontFamily: "var(--mono)", color: "var(--muted)" }}>{r.ym || "—"}</td>
                        <td style={{ ...td(true), fontVariantNumeric: "tabular-nums" }}>{gbp(r.a)}</td>
                        <td style={{ ...td(true), fontVariantNumeric: "tabular-nums" }}>{gbp(r.b)}</td>
                        <td style={{ ...td(true), fontVariantNumeric: "tabular-nums", color: r.delta >= 0 ? "var(--green)" : "var(--red)" }}>{gbp(r.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {diff.rows.length > 100 && <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Showing the 100 largest changes of {diff.rows.length.toLocaleString()}.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
