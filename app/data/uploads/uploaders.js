"use client";
import { useRef, useState } from "react";
import { FACILITY_UPLOAD_COLUMNS } from "../../../lib/treasury-rules";

/*
 * In-place uploader for the Data Uploads hub. The file is read and posted to the
 * feed's existing ingest endpoint right here — so the hub is genuinely "one
 * location", never a redirect to another page. Mirrors the base64 workbook post
 * the individual screens use. Each instance is self-contained (own ref + state),
 * so many can sit on one page.
 */

function summarise(j) {
  if (j.fixed != null || j.variable != null) return `Loaded ${Number(j.loaded).toLocaleString("en-GB")} cost-model lines · ${j.fixed || 0} fixed · ${j.variable || 0} variable${j.monthRates ? ` · ${Number(j.monthRates).toLocaleString("en-GB")} monthly rates` : ""}${j.stores ? ` · ${j.stores} stores` : ""}.`;
  if (j.loaded != null) return `Loaded ${Number(j.loaded).toLocaleString("en-GB")} actual lines${j.stores ? ` · ${j.stores} stores` : ""}${j.months ? ` · ${j.months} months` : ""}.`;
  if (j.rows != null) return `Loaded ${Number(j.rows).toLocaleString("en-GB")} rows${j.months?.length ? ` · ${j.months.length} month(s): ${j.months.join(", ")}` : ""}.`;
  if (j.name && j.lines != null) return `Imported the ${j.name} layout (${j.lines} lines)${j.needMap?.length ? ` · ${j.needMap.length} line(s) need a nominal mapped` : ""}.`;
  if (j.count != null) return `Loaded ${Number(j.count).toLocaleString("en-GB")} rows.`;
  return "Uploaded — the figures now flow through the platform.";
}

const ACCEPT = ".xlsx,.xlsb,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function InlineUpload({ endpoint, action, fileField = "file", label = "Upload Excel" }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tone, setTone] = useState("var(--muted)");

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setMsg("Reading workbook…"); setTone("var(--muted)");
    try {
      const buf = await f.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const body = { action }; body[fileField] = btoa(bin);
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      const warns = Array.isArray(j.warnings) ? j.warnings : [];
      setMsg(summarise(j) + (warns.length ? ` ⚠ ${warns[0]}` : ""));
      setTone(warns.length ? "var(--amber)" : "var(--green)");
    } catch (x) {
      setMsg(x.message); setTone("var(--red)");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}>
      <button onClick={() => ref.current?.click()} disabled={busy}
        style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Uploading…" : label}
      </button>
      <input ref={ref} type="file" accept={ACCEPT} onChange={onFile} style={{ display: "none" }} />
      {msg && <span style={{ fontSize: 11.5, color: tone }}>{msg}</span>}
    </div>
  );
}

/*
 * Bank trade facility (HSBC) uploader. The facility register is a CSV extract, not
 * an Excel workbook, and posts raw CSV text as { op: "upload-facility", csv } to
 * /api/treasury (replace-mode) — a different shape from InlineUpload's base64
 * workbook post — so it has its own component here, plus a template download.
 */
export function FacilityCsvUpload({ rowCount = 0 }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tone, setTone] = useState("var(--muted)");

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (ref.current) ref.current.value = "";       // allow re-selecting the same file
    if (!f) return;
    if (rowCount && !window.confirm(`Replace the whole bank trade facility register (${rowCount} drawing${rowCount === 1 ? "" : "s"}) with the contents of “${f.name}”? This cannot be undone.`)) return;
    setBusy(true); setMsg("Reading CSV…"); setTone("var(--muted)");
    try {
      const csv = await f.text();
      const res = await fetch("/api/treasury", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "upload-facility", csv }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setMsg(`Loaded ${Number(j.loaded || 0).toLocaleString("en-GB")} facility drawing${(j.loaded || 0) === 1 ? "" : "s"} — the figures now flow through Treasury and the dashboards.`);
      setTone("var(--green)");
    } catch (x) {
      setMsg(x.message); setTone("var(--red)");
    } finally {
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(FACILITY_UPLOAD_COLUMNS.join(",") + "\n")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <button onClick={() => ref.current?.click()} disabled={busy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Uploading…" : "Upload HSBC facility extract (CSV)"}
        </button>
        <input ref={ref} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
        {msg && <span style={{ fontSize: 11.5, color: tone }}>{msg}</span>}
      </div>
      <a href={templateHref} download="bank-trade-facility-template.csv" style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "none" }}>Download template (CSV) ↓</a>
    </div>
  );
}
