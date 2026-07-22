"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// P&L format governance: per-scope structure, mapping health, and an
// assign-nominal-to-line control for anything currently unmapped.
export default function FormatsAdmin({ formats, reports, canManage, scopeKinds }) {
  const router = useRouter();
  const [open, setOpen] = useState(formats.find((f) => reports[f.kind]?.unmapped?.length)?.kind || formats[0]?.kind);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const [upMsg, setUpMsg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [fmtMsg, setFmtMsg] = useState(null);
  const [fmtBusy, setFmtBusy] = useState(false);
  const money = (v) => "£" + Math.round(Math.abs(v)).toLocaleString();

  async function toB64(file) {
    const buf = await file.arrayBuffer(); const bytes = new Uint8Array(buf);
    let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  const [refreshing, setRefreshing] = useState(false);
  async function refreshFromJoiin() {
    setRefreshing(true); setUpMsg(null); setErr(null);
    try {
      const res = await fetch("/api/joiin-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Refresh failed");
      setUpMsg(`Refreshed from Joiin: ${j.entityRows?.toLocaleString?.() ?? j.entityRows} rows across ${(j.months || []).join(", ")}.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setRefreshing(false); }
  }

  async function uploadFormat(file) {
    if (!file) return;
    setFmtBusy(true); setFmtMsg(null); setErr(null);
    try {
      const res = await fetch("/api/pl-formats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "formatWorkbook", file: await toB64(file) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Import failed");
      const bits = [`Imported the ${j.name} layout (${j.lines} lines).`];
      if (j.needMap?.length) bits.push(`${j.needMap.length} line(s) need a nominal mapped: ${j.needMap.join(", ")}.`);
      if (j.warnings?.length) bits.push(`${j.warnings.length} row(s) couldn't be auto-derived — check them.`);
      setFmtMsg({ text: bits.join(" "), warn: (j.needMap?.length || 0) + (j.warnings?.length || 0) > 0 });
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setFmtBusy(false); }
  }

  async function uploadWorkbook(file) {
    if (!file) return;
    setUploading(true); setUpMsg(null); setErr(null);
    try {
      const buf = await file.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/pl-formats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "workbook", file: btoa(bin) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setUpMsg(`Loaded ${j.rows.toLocaleString()} rows across ${j.months?.length || 0} month(s): ${(j.months || []).join(", ")}.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setUploading(false); }
  }

  async function assign(kind, account, line) {
    if (!line) return;
    setBusy(account); setErr(null);
    try {
      const res = await fetch("/api/pl-formats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", scopeKind: kind, account, line }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not assign");
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canManage && (
        <div className="fos-card" style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>Upload a P&L format template</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3, maxWidth: "58ch" }}>
              Upload a board-pack P&L template (Store, Head Office, Franchise or Consolidated). The layout — sections,
              subtotals and derived lines (Gross Profit, EBITDA, margins) — is read from the sheet and becomes the
              governed format. Nominal lines map by name; any friendly-named line is flagged to map below.
            </div>
            {fmtMsg && <div style={{ fontSize: 12.5, color: fmtMsg.warn ? "var(--amber, #b8860b)" : "var(--green)", marginTop: 6, maxWidth: "62ch" }}>{fmtMsg.text}</div>}
          </div>
          <label className="fos-btn" style={{ cursor: fmtBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
            {fmtBusy ? "Reading…" : "Upload format"}
            <input type="file" accept=".xlsx,.xls" hidden disabled={fmtBusy}
              onChange={(e) => uploadFormat(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {canManage && (
        <div className="fos-card" style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 650, fontSize: 13.5 }}>Load Joiin by-company P&L</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3, maxWidth: "56ch" }}>
              Upload the Joiin by-company export — one sheet per month (name each sheet for its month, e.g. <span style={{ fontFamily: "var(--mono)" }}>2026-06</span> or <span style={{ fontFamily: "var(--mono)" }}>Jun 26</span>), entities across the columns. Standalone (un-eliminated) figures. Upserts the months in the file.
            </div>
            {upMsg && <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 6 }}>{upMsg}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="fos-btn fos-btn-ghost" onClick={refreshFromJoiin} disabled={refreshing} style={{ cursor: refreshing ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              {refreshing ? "Refreshing…" : "Refresh from Joiin"}
            </button>
            <label className="fos-btn" style={{ cursor: uploading ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              {uploading ? "Loading…" : "Upload workbook"}
              <input type="file" accept=".xlsx,.xls" hidden disabled={uploading}
                onChange={(e) => uploadWorkbook(e.target.files?.[0])} />
            </label>
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: "var(--red)", background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8, padding: "8px 12px" }}>{err}</div>}
      {formats.map((f) => {
        const rep = reports[f.kind];
        const isOpen = open === f.kind;
        const unmapped = rep?.unmapped || [];
        const pending = f.source === "none";
        return (
          <div key={f.kind} className="fos-card" style={{ padding: 0, overflow: "hidden" }}>
            <button onClick={() => setOpen(isOpen ? null : f.kind)}
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: 14 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{scopeKinds.find((s) => s.kind === f.kind)?.note}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
                {pending ? (
                  <span style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>pending elimination</span>
                ) : (
                  <>
                    <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>{f.spec.length} lines · {rep?.mappedCount ?? 0} mapped</span>
                    {unmapped.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", background: "var(--red-bg)", borderRadius: 20, padding: "2px 9px" }}>{unmapped.length} unmapped</span>
                    )}
                    {unmapped.length === 0 && rep && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", background: "var(--green-bg)", borderRadius: 20, padding: "2px 9px" }}>fully mapped</span>
                    )}
                  </>
                )}
                <span style={{ color: "var(--faint)", fontSize: 12 }}>{isOpen ? "▾" : "▸"}</span>
              </div>
            </button>

            {isOpen && (
              <div style={{ borderTop: "1px solid var(--line)", padding: "14px 18px" }}>
                {pending && (
                  <div style={{ fontSize: 13, color: "var(--faint)" }}>
                    This layout is defined once its intercompany wholesale elimination is confirmed. The Store and
                    Franchise layouts are live; Head Office and Consolidated follow.
                  </div>
                )}

                {!pending && unmapped.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="fos-eyebrow" style={{ color: "var(--red)" }}>Unmapped nominals — {unmapped.length}</div>
                    <div style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 10px" }}>Present in the data but not in any line. Assign each to the line it belongs under.</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {unmapped.map((u) => (
                        <div key={u.account} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, minWidth: 240 }}>{u.account}</span>
                          <span className="fos-num" style={{ color: "var(--muted)", minWidth: 90 }}>{money(u.total)}</span>
                          {canManage ? (
                            <select className="fos-input" defaultValue="" disabled={busy === u.account}
                              onChange={(e) => assign(f.kind, u.account, e.target.value)}
                              style={{ fontSize: 12.5, maxWidth: 320 }}>
                              <option value="" disabled>{busy === u.account ? "Saving…" : "Assign to line…"}</option>
                              {rep.lineLabels.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                          ) : <span style={{ fontSize: 12, color: "var(--faint)" }}>needs ADMIN/FINANCE</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!pending && (
                  <div>
                    <div className="fos-eyebrow">Layout</div>
                    <div style={{ marginTop: 8, display: "grid", gap: 1 }}>
                      {f.spec.map((e, i) => {
                        if (e.kind === "section") return <div key={i} style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", padding: "10px 0 3px" }}>{e.label}</div>;
                        if (e.kind === "sub") return <div key={i} style={{ fontSize: 12, fontStyle: "italic", color: "var(--muted)", padding: "3px 0 3px 12px" }}>{e.label}</div>;
                        const derived = e.kind === "total" || e.kind === "calc" || e.kind === "pct";
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0 3px " + (e.kind === "line" ? "20px" : "6px"), fontSize: 12.5, fontWeight: derived ? 650 : 400, color: derived ? "var(--ink)" : "var(--muted)", borderTop: e.kind === "calc" ? "1px solid var(--hairline)" : undefined }}>
                            <span>{e.label}</span>
                            {e.kind === "line" && <span style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>{(e.accounts || []).length} nominal{(e.accounts || []).length === 1 ? "" : "s"}</span>}
                            {e.kind === "pct" && <span style={{ fontSize: 11, color: "var(--faint)" }}>%</span>}
                          </div>
                        );
                      })}
                    </div>
                    {f.updatedBy && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 12 }}>v{f.version} · last edited by {f.updatedBy}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
