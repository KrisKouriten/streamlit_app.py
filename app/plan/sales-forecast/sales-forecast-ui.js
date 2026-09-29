"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

      {shown && detail && <StoreCheck key={shown.id} id={shown.id} year={new Date().getFullYear()} canManage={canManage} busy={busy} setBusy={setBusy} post={post} onDone={(m) => { setMsg(m); router.refresh(); }} />}

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

/*
 * How this version's stores line up with the trading stores, and the two fixes.
 *
 *   * Forecast on a store record the dashboards don't report (no operator, or
 *     marked Other). If that record has traded, it IS the store — just never
 *     set up — so "Put on dashboards" gives it an ownership and operator, and
 *     its actual sales come through as well as its forecast. If it hasn't,
 *     the store trades under another name: link it.
 *   * A forecast store with no sales this year: not open yet, or named
 *     differently from the store it trades as — link it, or leave it.
 *
 * A link moves the forecast onto the trading store and is remembered, so the
 * next upload lands there first time.
 */
function StoreCheck({ id, year, canManage, busy, setBusy, post, onDone }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState({});      // store_id → chosen trading store_id
  const [own, setOwn] = useState({});        // store_id → { ownership, operator }
  useEffect(() => {
    let live = true;
    fetch(`/api/sales-forecast?id=${id}&check=${year}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (!live) return; if (ok) setC(j); else setErr(j.error || "Could not check the stores"); })
      .catch(() => { if (live) setErr("Could not check the stores"); });
    return () => { live = false; };
  }, [id, year]);
  async function run(body, done) {
    setBusy(true);
    try { const r = await post(body); onDone(done(r)); }
    catch (e) { onDone(e.message); } finally { setBusy(false); }
  }
  const link = (r) => {
    const to = Number(pick[r.store_id] ?? r.suggested);
    if (!to) return;
    const t = c.candidates.find((x) => x.store_id === to);
    if (!window.confirm(`Link the forecast for "${r.store_name}" to "${t?.store_name}"? Its forecast moves onto that store, and future uploads will do the same.`)) return;
    run({ action: "link", from: r.store_id, to }, (x) => `Linked ${x.forecastName} → ${x.tradingName}.`);
  };
  const report = (r) => {
    const o = own[r.store_id] || {};
    const ownership = o.ownership || "COMPANY";
    const entityId = Number(o.entityId ?? r.entity_id) || null;
    const ent = (c.entities || []).find((e) => e.entity_id === entityId);
    run({ action: "report", id: r.store_id, ownership, operator: o.operator || "", entityId },
      (x) => `${x.store} is now reported on the dashboards as a ${ownership.toLowerCase()} store${ent ? ` under ${ent.name}` : ""}.`);
  };
  if (err) return <div style={{ ...card, fontSize: 12.5, color: "var(--faint)" }}>{err}</div>;
  if (!c) return null;
  const rows = [
    ...c.notReported.map((r) => ({ ...r, issue: "NOT_REPORTED" })),
    ...c.noActuals.map((r) => ({ ...r, issue: "NO_SALES" })),
  ];
  const sel = { height: 30, fontSize: 12, padding: "0 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)", maxWidth: 230 };
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>Store matching · {year}</div>
        {canManage && c.notReported.length > 0 && <button className="fos-btn-ghost" disabled={busy} onClick={() => run({ action: "rematch", id }, (r) => (r.moved?.length ? `Re-matched ${r.moved.length} store${r.moved.length === 1 ? "" : "s"}: ${r.moved.map((m) => m.store).join(", ")}.` : "No duplicate store records to move — link or report the stores below."))}>Re-match by name</button>}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 6 }}>Every forecast store is a reported store that has traded this year.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 12px", lineHeight: 1.5 }}>
            {c.notReported.length > 0 && <><strong style={{ color: "var(--red)" }}>{gbp(c.notReportedValue)}</strong> of the {year} forecast is on store records the dashboards don&rsquo;t report, so it is missing from the FY plan. </>}
            Link a forecast store to the store it trades as, or — where the record has sales but was never set up — put it on the dashboards.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thL}>Forecast store</th><th style={th}>{year} forecast</th><th style={th}>{year} sales on this record</th><th style={thL}>Issue</th>{canManage && <th style={thL}>Fix</th>}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const traded = r.actual_year > 0;
                  const chosen = pick[r.store_id] ?? (r.suggested ? String(r.suggested) : "");
                  return (
                    <tr key={`${r.issue}-${r.store_id}`}>
                      <td style={tdL}><strong>{r.store_name}</strong></td>
                      <td style={td}>{gbp(r.fc_year)}</td>
                      <td style={td}>{traded ? gbp(r.actual_year) : "—"}</td>
                      <td style={{ ...tdL, color: r.issue === "NOT_REPORTED" ? "var(--red)" : "var(--amber)", whiteSpace: "normal", maxWidth: 260 }}>
                        {r.issue === "NOT_REPORTED"
                          ? (traded ? "Trades, but the record has no operator / is marked Other — its sales and forecast are both left off the dashboards" : "On a record the dashboards don't report, with no sales — probably trades under another name")
                          : "No sales this year — not open yet, or trades under another name"}
                      </td>
                      {canManage && (
                        <td style={{ ...tdL, whiteSpace: "normal" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {r.issue === "NOT_REPORTED" && (
                              <>
                                <select style={sel} value={own[r.store_id]?.ownership || "COMPANY"} onChange={(e) => setOwn((o) => ({ ...o, [r.store_id]: { ...o[r.store_id], ownership: e.target.value } }))}>
                                  <option value="COMPANY">Company</option><option value="FRANCHISE">Franchise</option>
                                </select>
                                {(c.entities || []).length > 0 && (
                                  <select style={sel} title="The legal entity the store trades under" value={String(own[r.store_id]?.entityId ?? r.entity_id ?? "")}
                                    onChange={(e) => setOwn((o) => ({ ...o, [r.store_id]: { ...o[r.store_id], entityId: e.target.value } }))}>
                                    {(c.entities || []).map((e) => <option key={e.entity_id} value={e.entity_id}>{e.name}</option>)}
                                  </select>
                                )}
                                {(own[r.store_id]?.ownership === "FRANCHISE") && (
                                  <input style={{ ...sel, width: 150 }} placeholder="Franchise operator" value={own[r.store_id]?.operator || ""} onChange={(e) => setOwn((o) => ({ ...o, [r.store_id]: { ...o[r.store_id], operator: e.target.value } }))} />
                                )}
                                <button className={traded ? "fos-btn" : "fos-btn-ghost"} disabled={busy} onClick={() => report(r)}>Put on dashboards</button>
                                <span style={{ fontSize: 11, color: "var(--faint)" }}>or</span>
                              </>
                            )}
                            <select style={sel} value={chosen} onChange={(e) => setPick((p) => ({ ...p, [r.store_id]: e.target.value }))}>
                              <option value="">Link to the store it trades as…</option>
                              {c.candidates.map((t) => (
                                <option key={t.store_id} value={t.store_id} disabled={t.hasForecast}>
                                  {t.store_name}{t.hasForecast ? " (already has a forecast)" : ""}{Number(r.suggested) === t.store_id ? " — suggested" : ""}
                                </option>
                              ))}
                            </select>
                            <button className={!traded || r.issue === "NO_SALES" ? "fos-btn" : "fos-btn-ghost"} disabled={busy || !chosen} onClick={() => link(r)}>Link</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
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
