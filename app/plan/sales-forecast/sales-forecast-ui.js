"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, Badge } from "../../finance-os/ui";
import { versionLabelFromFilename, compareForecasts } from "../../../lib/sales-forecast-rules";

/* Sales Forecast — upload versions of the 4-year sales forecast, choose the live
   one, and read any version consolidated by month and year, store by store. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 20 };
const th = { textAlign: "right", padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const thL = { ...th, textAlign: "left" };
const td = { textAlign: "right", padding: "7px 10px", borderBottom: "1px solid var(--hairline)", fontSize: 12.5, whiteSpace: "nowrap" };
const tdL = { ...td, textAlign: "left" };
const tdTot = { ...td, fontWeight: 650, borderTop: "1px solid var(--line)" };
const seg = (on) => ({
  fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
  border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`, background: on ? "var(--surface)" : "transparent",
  boxShadow: on ? "var(--shadow-1)" : "none", color: on ? "var(--ink)" : "var(--muted)",
});
const segWrap = { display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 };
const gbp = (v) => (v ? money(v) : "—");
const delta = (v) => {
  if (!v || Math.abs(v) < 0.5) return <span style={{ color: "var(--faint)" }}>—</span>;
  return <span style={{ color: v > 0 ? "var(--green)" : "var(--red)" }}>{v > 0 ? "+" : "−"}{money(Math.abs(v))}</span>;
};
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export default function SalesForecastUI({ versions = [], shownId = null, detail = null, canManage = false }) {
  const router = useRouter();
  const shown = versions.find((v) => v.id === shownId) || null;
  const years = useMemo(() => Object.keys(detail?.years || {}).sort(), [detail]);
  const [view, setView] = useState("year");          // "year" | "month"
  const [year, setYear] = useState(null);
  const [channel, setChannel] = useState("ALL");      // ALL | COMPANY | FRANCHISE
  const [cmpId, setCmpId] = useState("");
  const [cmp, setCmp] = useState(null);                // the comparison version's figures
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const activeYear = year || years.find((y) => y === String(new Date().getFullYear())) || years[0];

  async function post(body) {
    const res = await fetch("/api/sales-forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function compareWith(id) {
    setCmpId(id); setCmp(null);
    if (!id) return;
    try {
      const res = await fetch(`/api/sales-forecast?id=${id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load that version");
      setCmp(j);
    } catch (e) { setMsg(e.message); setCmpId(""); }
  }
  async function makeLive(v) {
    if (!window.confirm(`Make "${v.label}" the live sales forecast? The dashboards, home page and Executive Hub will compare against it, and Forecast Builder's company store sales will update.`)) return;
    setBusy(true); setMsg("");
    try { await post({ action: "live", id: v.id }); setMsg(`${v.label} is now the live forecast.`); router.refresh(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function remove(v) {
    if (!window.confirm(`Delete version ${v.version} (${v.label}) and all its figures? This cannot be undone.`)) return;
    setBusy(true); setMsg("");
    try { await post({ action: "delete", id: v.id }); setMsg(`Deleted ${v.label}.`); router.push("/plan/sales-forecast"); router.refresh(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  // Consolidated rows for the table: years, or the months of the chosen year.
  const pick = (o) => (channel === "COMPANY" ? o.company : channel === "FRANCHISE" ? o.franchise : o.total);
  const rowKeys = view === "year" ? years : Object.keys(detail?.months || {}).filter((m) => m.startsWith(activeYear)).sort();
  const source = view === "year" ? detail?.years || {} : detail?.months || {};
  const diff = cmp ? compareForecasts(view === "year" ? cmp.years : cmp.months, source) : null;
  const sum = (k) => rowKeys.reduce((t, r) => t + (source[r]?.[k] || 0), 0);
  const stores = (detail?.stores || []).filter((s) => channel === "ALL" || s.channel === channel);
  const storeCols = view === "year" ? years : rowKeys;
  const storeVal = (s, k) => (view === "year" ? s.years[k] : s.months[k]) || 0;

  return (
    <>
      {canManage && <Upload busy={busy} setBusy={setBusy} onDone={(m) => { setMsg(m); router.refresh(); }} post={post} />}
      {msg && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{msg}</div>}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>Versions</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12, lineHeight: 1.5 }}>
          The <strong>live</strong> version drives the store dashboards, the home page and the Executive Intelligence Hub, and feeds company store sales into Forecast Builder. A new upload loads as a draft — check it here, then make it live.
        </div>
        {versions.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No sales forecast uploaded yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thL}>Version</th><th style={thL}>Uploaded</th>
                {[...new Set(versions.flatMap((v) => Object.keys(v.years)))].sort().map((y) => <th key={y} style={th}>FY{y}</th>)}
                <th style={thL}>Status</th><th style={th} />
              </tr></thead>
              <tbody>
                {versions.map((v) => {
                  const ys = [...new Set(versions.flatMap((x) => Object.keys(x.years)))].sort();
                  return (
                    <tr key={v.id} style={{ background: v.id === shownId ? "var(--accent-bg, color-mix(in srgb, var(--accent) 7%, transparent))" : undefined }}>
                      <td style={tdL}><strong>v{v.version}</strong> · {v.label}</td>
                      <td style={{ ...tdL, color: "var(--muted)" }}>{v.createdAt ? new Date(v.createdAt).toLocaleDateString("en-GB") : "—"}</td>
                      {ys.map((y) => <td key={y} style={td}>{gbp(v.years[y]?.total)}</td>)}
                      <td style={tdL}>{v.live ? <Badge tone="green">Live</Badge> : <Badge tone="muted">{v.status === "SUPERSEDED" ? "Superseded" : "Draft"}</Badge>}</td>
                      <td style={{ ...td, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {v.id !== shownId && <button className="fos-btn-ghost" disabled={busy} onClick={() => router.push(`/plan/sales-forecast?v=${v.id}`)}>View</button>}
                        {canManage && !v.live && <button className="fos-btn-ghost" disabled={busy} onClick={() => makeLive(v)}>Make live</button>}
                        {canManage && !v.live && <button className="fos-btn-ghost" disabled={busy} style={{ color: "var(--red)" }} onClick={() => remove(v)}>Delete</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {shown && detail && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>
              v{shown.version} · {shown.label} {shown.live && <Badge tone="green">Live</Badge>}
            </div>
            <div style={segWrap}>
              {[["year", "By year"], ["month", "By month"]].map(([k, l]) => <button key={k} style={seg(view === k)} onClick={() => setView(k)}>{l}</button>)}
            </div>
            <div style={segWrap}>
              {[["ALL", "Consolidated"], ["COMPANY", "Company"], ["FRANCHISE", "Franchise"]].map(([k, l]) => <button key={k} style={seg(channel === k)} onClick={() => setChannel(k)}>{l}</button>)}
            </div>
            {view === "month" && (
              <label style={{ fontSize: 12.5, color: "var(--faint)", display: "inline-flex", gap: 6, alignItems: "center" }}>
                Year
                <select className="fos-input" value={activeYear} onChange={(e) => setYear(e.target.value)} style={{ fontSize: 12.5, padding: "5px 9px" }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            )}
            <label style={{ fontSize: 12.5, color: "var(--faint)", display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              Compare with
              <select className="fos-input" value={cmpId} onChange={(e) => compareWith(e.target.value)} style={{ fontSize: 12.5, padding: "5px 9px" }}>
                <option value="">— none —</option>
                {versions.filter((v) => v.id !== shownId).map((v) => <option key={v.id} value={v.id}>v{v.version} · {v.label}</option>)}
              </select>
            </label>
          </div>

          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 10 }}>
              Consolidated position {view === "month" ? `· ${activeYear} by month` : "· by year"}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={thL}>{view === "year" ? "Year" : "Month"}</th>
                  <th style={th}>Company</th><th style={th}>Franchise</th><th style={th}>Consolidated</th>
                  {diff && <th style={th}>vs v{versions.find((v) => String(v.id) === String(cmpId))?.version}</th>}
                </tr></thead>
                <tbody>
                  {rowKeys.map((k) => (
                    <tr key={k}>
                      <td style={tdL}>{view === "year" ? `FY${k}` : monthLabel(k)}</td>
                      <td style={td}>{gbp(source[k]?.company)}</td>
                      <td style={td}>{gbp(source[k]?.franchise)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{gbp(source[k]?.total)}</td>
                      {diff && <td style={td}>{delta(pick(diff[k] || { company: 0, franchise: 0, total: 0 }))}</td>}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...tdTot, textAlign: "left" }}>{view === "year" ? "All years" : `FY${activeYear}`}</td>
                    <td style={tdTot}>{gbp(sum("company"))}</td>
                    <td style={tdTot}>{gbp(sum("franchise"))}</td>
                    <td style={tdTot}>{gbp(sum("total"))}</td>
                    {diff && <td style={tdTot}>{delta(rowKeys.reduce((t, k) => t + pick(diff[k] || { company: 0, franchise: 0, total: 0 }), 0))}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
            {diff && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>The difference column is this version less the one compared with, on the {channel === "ALL" ? "consolidated" : channel.toLowerCase()} figure.</div>}
          </div>

          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 10 }}>
              By store · {channel === "ALL" ? `${stores.length} stores` : `${stores.length} ${channel.toLowerCase()} stores`}{view === "month" ? ` · ${activeYear}` : ""}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={thL}>Store</th>
                  {storeCols.map((k) => <th key={k} style={th}>{view === "year" ? `FY${k}` : MONTHS[Number(k.slice(5, 7)) - 1]}</th>)}
                  <th style={th}>{view === "year" ? "All years" : `FY${activeYear}`}</th>
                </tr></thead>
                <tbody>
                  {stores.map((s) => {
                    const tot = storeCols.reduce((t, k) => t + storeVal(s, k), 0);
                    return (
                      <tr key={s.store}>
                        <td style={tdL}>{s.store} <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{s.channel === "COMPANY" ? "company" : "franchise"}</span></td>
                        {storeCols.map((k) => <td key={k} style={td}>{gbp(storeVal(s, k))}</td>)}
                        <td style={{ ...td, fontWeight: 600 }}>{gbp(tot)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Upload({ busy, setBusy, onDone, post }) {
  const ref = useRef(null);
  const [label, setLabel] = useState("");
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const useLabel = label.trim() || versionLabelFromFilename(f.name);
    setBusy(true); setState(`Loading ${f.name}… this takes a few seconds.`);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await post({ action: "upload", file: btoa(bin), filename: f.name, label: useLabel });
      const yrs = Object.entries(r.years || {}).map(([y, t]) => `FY${y} £${Math.round(t.total).toLocaleString("en-GB")}`).join(" · ");
      const notes = [
        r.newStores?.length ? `${r.newStores.length} store${r.newStores.length === 1 ? "" : "s"} not in the store list were added — check the names: ${r.newStores.slice(0, 8).join(", ")}${r.newStores.length > 8 ? "…" : ""}` : null,
        r.ownershipDiffers?.length ? `company/franchise differs from the store list for: ${r.ownershipDiffers.slice(0, 5).join("; ")}` : null,
      ].filter(Boolean);
      setState("");
      setLabel("");
      onDone(`Loaded v${r.version} · ${r.label} — ${r.companyStores} company + ${r.franchiseStores} franchise stores · ${yrs}. ${r.live ? "It is the live forecast." : "Loaded as a draft — make it live when you've checked it."}${notes.length ? ` Note: ${notes.join(" · ")}.` : ""}`);
    } catch (x) { setState(x.message); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  }
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 3 }}>Upload a sales forecast</div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12, lineHeight: 1.5 }}>
        The 4-year sales forecast workbook as it is — company and franchise stores, daily. Checked against its own subtotals before anything is saved; each upload is kept as a new version.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="fos-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Version name (defaults to the file name, e.g. Sept26 v0.3)"
          style={{ fontSize: 12.5, padding: "7px 10px", minWidth: 320 }} />
        <button className="fos-btn" disabled={busy} onClick={() => ref.current?.click()}>Upload sales forecast</button>
        <input ref={ref} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} style={{ display: "none" }} />
      </div>
      {state && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>{state}</div>}
    </div>
  );
}
