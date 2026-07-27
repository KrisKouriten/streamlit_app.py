"use client";
import { useState } from "react";

/*
 * "Add to Report" (CR §8) — a small client widget droppable onto any dashboard.
 * It saves the underlying source key + current filters into a draft report
 * (existing or new) so the report page refreshes from governed data, never a
 * screenshot. Props: { sourceKey, sourceRoute, defaultTitle, componentType }.
 */
export default function AddToReport({ sourceKey, sourceRoute = null, defaultTitle = "Dashboard view", componentType = "table", filters = {} }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [reportId, setReportId] = useState("new");
  const [title, setTitle] = useState(defaultTitle);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  async function toggle() {
    const next = !open; setOpen(next); setDone(null); setError(null);
    if (next && drafts === null) {
      try {
        const res = await fetch("/api/reports-centre?mine=1");
        const j = await res.json();
        setDrafts(res.ok ? (j.reports || []) : []);
      } catch { setDrafts([]); }
    }
  }

  async function add() {
    setBusy(true); setError(null);
    try {
      const body = { sectionTitle: title, sourceKey, sourceRoute, componentType, filters };
      if (reportId && reportId !== "new") body.reportId = reportId; else body.newTitle = title;
      const res = await fetch("/api/reports-centre/add-to-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not add to report");
      setDone(j.reportId);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button onClick={toggle} style={{ fontSize: 12, fontWeight: 600, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}>
        + Add to Report
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 280, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-1)", padding: 14 }}>
          {done ? (
            <div style={{ fontSize: 13 }}>
              Added. <a href={`/finance-os/home/reports/${done}`} style={{ color: "var(--accent)" }}>Open report →</a>
            </div>
          ) : (
            <>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>Add to report</div>
              <select value={reportId} onChange={(e) => setReportId(e.target.value)} style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", marginBottom: 8 }}>
                <option value="new">＋ New report (Weekly Trade Pack)</option>
                {(drafts || []).map((d) => <option key={d.report_id} value={d.report_id}>{d.title}</option>)}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Section title" style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", marginBottom: 8 }} />
              {error && <div style={{ fontSize: 11.5, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
              <button onClick={add} disabled={busy} style={{ width: "100%", fontSize: 12.5, fontWeight: 650, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Adding…" : "Add"}
              </button>
              <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 6 }}>Saves the source & filters — refreshes from governed data.</div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
