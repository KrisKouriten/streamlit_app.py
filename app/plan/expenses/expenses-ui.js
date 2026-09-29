"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../../lib/money-rules.js";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 20 };
const sel = { height: 32, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" };
const ukDate = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "—");

/*
 * Create migration 117's tables through the app's own connection — for when
 * the SQL editor ran it on a different branch from the one the app reads.
 */
export function CreateTables() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function go() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not create the tables");
      setMsg("Expense tables created.");
      router.refresh();
    } catch (x) { setMsg(x.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <button className="fos-btn" disabled={busy} onClick={go}>{busy ? "Creating…" : "Create the expense tables now"}</button>
      {msg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

/*
 * Finance's tools on Expense Claims: upload the Xero export, and map any
 * department the export names that the app does not know.
 */
export default function ExpenseTools({ uploads = [], unmapped = [], departments = [] }) {
  const router = useRouter();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pick, setPick] = useState({});

  async function post(body) {
    const res = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setMsg(`Reading ${f.name}…`);
    try {
      const text = await f.text();
      const r = await post({ action: "upload", text, filename: f.name });
      setMsg(`Loaded ${r.lines.toLocaleString("en-GB")} claim lines, ${ukDate(r.dateFrom)} to ${ukDate(r.dateTo)} — ${money(r.net)} net, ${money(r.vat)} VAT.`
        + (r.replaced ? ` Replaced the ${r.replaced.toLocaleString("en-GB")} lines already loaded for those dates.` : "")
        + (r.unmapped?.length ? ` ${r.unmapped.length} department${r.unmapped.length === 1 ? "" : "s"} to map below.` : ""));
      router.refresh();
    } catch (x) { setMsg(x.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function map(fileDept) {
    const appDept = pick[fileDept];
    if (!appDept) return;
    setBusy(true);
    try { await post({ action: "map", fileDept, appDept }); setMsg(`${fileDept} now reports as ${appDept}.`); router.refresh(); }
    catch (x) { setMsg(x.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 650 }}>Upload expense claims</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3, lineHeight: 1.5 }}>
              The Xero expense-claims export (CSV) with its Department column. Loading it replaces the claims already loaded for the same dates, so the year-to-date export can be loaded again each month.
            </div>
          </div>
          <label className="fos-btn" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Working…" : "Upload export"}
            <input ref={input} type="file" accept=".csv,text/csv" disabled={busy} onChange={onFile} style={{ display: "none" }} />
          </label>
        </div>
        {msg && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>{msg}</div>}
        {uploads.length > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>
            Last upload: {uploads[0].filename || "export"} · {Number(uploads[0].line_count).toLocaleString("en-GB")} lines · {ukDate(uploads[0].date_from)} – {ukDate(uploads[0].date_to)} · {money(uploads[0].net_total)} net · by {uploads[0].uploaded_by || "—"} on {ukDate(String(uploads[0].uploaded_at).slice(0, 10))}
          </div>
        )}
      </div>

      {unmapped.length > 0 && (
        <div style={{ ...card, borderColor: "color-mix(in srgb, var(--amber) 40%, var(--line))" }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Departments to map</div>
          <div style={{ fontSize: 12, color: "var(--faint)", margin: "3px 0 12px", lineHeight: 1.5 }}>
            The export names these departments, which the app doesn&rsquo;t have. Map each one to the department whose Travel, Expenses &amp; Entertainment budget it should count against. The mapping is remembered for every later upload.
          </div>
          {unmapped.map((u) => (
            <div key={u.fileDept} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--hairline)" }}>
              <strong style={{ minWidth: 200, fontSize: 13 }}>{u.fileDept}</strong>
              <span style={{ fontSize: 12, color: "var(--faint)", minWidth: 160 }}>{u.lines.toLocaleString("en-GB")} lines · {money(u.net)}</span>
              <select style={sel} value={pick[u.fileDept] || ""} onChange={(e) => setPick((p) => ({ ...p, [u.fileDept]: e.target.value }))}>
                <option value="">Report as…</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <button className="fos-btn" disabled={busy || !pick[u.fileDept]} onClick={() => map(u.fileDept)}>Map</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
