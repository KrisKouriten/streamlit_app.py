"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money } from "../finance-os/ui";

/* Client UI for the Report Builder: the saved-report list with open / export /
   delete, a create form (dataset + parameters), and a rendered preview of the
   selected report that prints clean and exports to Excel. */

const PERIODS = [["current", "Current month"], ["trailing", "All months"], ["ytd", "Year to date"]];

async function post(body) {
  const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function PreviewTable({ view }) {
  const cols = view.cols || [];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "5px 8px", color: "var(--muted)", fontWeight: 600 }}></th>
            {cols.map((c) => <th key={c.key} style={{ textAlign: "right", padding: "5px 8px", color: "var(--muted)", fontWeight: 600 }}>{c.label}</th>)}
            {view.showTotal && <th style={{ textAlign: "right", padding: "5px 8px", color: "var(--muted)", fontWeight: 600 }}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => {
            if (r.kind === "section" || r.kind === "sub") {
              return <tr key={i}><td colSpan={cols.length + 1 + (view.showTotal ? 1 : 0)} style={{ padding: "8px 8px 3px", fontWeight: 700, fontSize: 11.5, letterSpacing: ".04em", color: "var(--muted)", textTransform: "uppercase" }}>{r.label}</td></tr>;
            }
            const fmt = (v) => (v == null ? "" : r.isPct ? `${(v * 100).toFixed(1)}%` : money(v));
            return (
              <tr key={i} style={{ borderTop: "1px solid var(--line)", fontWeight: r.strong ? 700 : 450,
                color: r.tone === "ebitda" ? "var(--accent)" : "var(--ink)" }}>
                <td style={{ padding: "5px 8px" }}>{r.label}</td>
                {cols.map((c) => <td key={c.key} style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.values?.[c.key])}</td>)}
                {view.showTotal && <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.total)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsUI({ reports, datasets, canManage, preview }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", datasetKey: datasets[0]?.key || "", period: "current", month: "", year: "" });

  const dataset = datasets.find((d) => d.key === form.datasetKey);
  const paramKinds = new Set((dataset?.params || []).map((p) => p.kind));

  async function create(e) {
    e.preventDefault();
    setErr(""); setBusy("create");
    const params = {};
    if (paramKinds.has("period")) params.period = form.period;
    if (paramKinds.has("month") && form.month) params.month = form.month;
    if (paramKinds.has("year") && form.year) params.year = form.year;
    try {
      await post({ action: "create", name: form.name, datasetKey: form.datasetKey, params });
      setForm({ name: "", datasetKey: datasets[0]?.key || "", period: "current", month: "", year: "" });
      setCreating(false);
      router.refresh();
    } catch (x) { setErr(x.message); } finally { setBusy(null); }
  }

  async function remove(id) {
    if (!window.confirm("Delete this saved report?")) return;
    setErr(""); setBusy(`del${id}`);
    try { await post({ action: "delete", id }); router.refresh(); }
    catch (x) { setErr(x.message); } finally { setBusy(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div className="fos-card" style={{ padding: "10px 14px", color: "var(--red)", fontSize: 13 }}>{err}</div>}

      {/* Saved reports */}
      <div className="fos-card no-print" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Saved reports</div>
          {canManage && <button className="fos-btn-ghost" onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New report"}</button>}
        </div>

        {creating && canManage && (
          <form onSubmit={create} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>
              Name
              <input className="fos-input" style={{ width: 220 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Board P&L pack" required />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>
              Dataset
              <select className="fos-input" style={{ width: "auto" }} value={form.datasetKey} onChange={(e) => setForm({ ...form, datasetKey: e.target.value })}>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            {paramKinds.has("period") && (
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>
                Period
                <select className="fos-input" style={{ width: "auto" }} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
                  {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            )}
            {paramKinds.has("month") && (
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>
                Month (YYYY-MM, optional)
                <input className="fos-input" style={{ width: 130 }} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} placeholder="latest" />
              </label>
            )}
            {paramKinds.has("year") && (
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>
                Year (optional)
                <input className="fos-input" style={{ width: 90 }} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="latest" />
              </label>
            )}
            <button className="fos-btn" disabled={busy === "create"}>{busy === "create" ? "Saving…" : "Save report"}</button>
          </form>
        )}

        {reports.length === 0 && <div style={{ fontSize: 13, color: "var(--faint)" }}>No saved reports yet{canManage ? " — create one above." : "."}</div>}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {reports.map((r, i) => (
            <div key={r.report_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div>
                <Link href={`/reports?id=${r.report_id}`} style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>{r.name}</Link>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.dataset_key}{r.params?.period ? ` · ${r.params.period}` : ""}{r.params?.month ? ` · ${r.params.month}` : ""}{r.params?.year ? ` · ${r.params.year}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Link className="fos-btn-ghost" href={`/reports?id=${r.report_id}`} style={{ fontSize: 11.5, padding: "2px 9px" }}>Open</Link>
                <a className="fos-btn-ghost" href={`/api/reports/${r.report_id}/export`} style={{ fontSize: 11.5, padding: "2px 9px" }}>⤓ Excel</a>
                {canManage && <button className="fos-btn-ghost" style={{ fontSize: 11.5, padding: "2px 9px" }} disabled={busy === `del${r.report_id}`} onClick={() => remove(r.report_id)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="fos-card" style={{ padding: "16px 20px" }}>
          <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{preview.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{preview.dataset}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <a className="fos-btn-ghost" href={`/api/reports/${preview.id}/export`}>⤓ Excel</a>
              <button className="fos-btn-ghost" onClick={() => window.print()}>⎙ Print / PDF</button>
            </div>
          </div>
          {!preview.ready && <div style={{ fontSize: 13, color: "var(--faint)" }}>{preview.reason || "No data to preview."}</div>}
          {preview.tabs.map((t, i) => (
            <div key={i} style={{ marginTop: i ? 18 : 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>{t.label}</div>
              <PreviewTable view={t.view} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
