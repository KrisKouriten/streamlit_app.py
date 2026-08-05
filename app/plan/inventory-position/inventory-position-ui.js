"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, StatRow, Stat, Badge } from "../../finance-os/ui";

/*
 * Inventory Position desk. Four tabs: stock in transit (Miniso only), stock in the
 * DC (warehouse), stock in the stores (every store), and an inventory summary that
 * shows the consolidated topline feeding OTB. Add/edit a position directly or bulk
 * upload a CSV. The summary is what the OTB Inventory tab reads.
 */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)", width: "100%" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };
// Module-scope so its identity is stable across renders — a Field defined inside
// the component would remount its input on every keystroke and lose focus.
function Field({ label, children }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={labelSt}>{label}</span>{children}</label>;
}
const tdR = { ...td, textAlign: "right" };
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

const CH = [["MINISO_MDS", "Miniso MDS"], ["LOCAL_PURCHASE", "Local Purchase"]];
const CH_LABEL = Object.fromEntries(CH);
const TABS = [
  ["IN_TRANSIT", "In transit"],
  ["WAREHOUSE", "DC / warehouse"],
  ["STORE", "Stores"],
  ["SUMMARY", "Inventory summary"],
];
const dateLabel = (d) => { if (!d) return "—"; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const CSV_TEMPLATE = "Channel,Location,Store,Units,Stock value,Reserved,Damaged,Confidence,Data through\nMiniso MDS,IN_TRANSIT,,0,500000,0,0,0.9,2026-06-30\nMiniso MDS,WAREHOUSE,,0,300000,20000,5000,1,2026-06-30\nMiniso MDS,STORE,ST001,0,45000,0,0,1,2026-06-30\n";

export default function InventoryPositionUI({ positions = [], summary, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState("IN_TRANSIT");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function op(body, ok) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const res = await fetch("/api/inventory-position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Action failed"); return null; }
      setMessage(ok); router.refresh(); return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }

  const g = summary.grand || {};
  return (
    <div>
      <StatRow>
        <Stat label="Stock in transit" value={money(g.inTransit || 0, { compact: true })} sub="Miniso · confidence-adj." />
        <Stat label="DC available" value={money(g.warehouse || 0, { compact: true })} sub="net reserved / damaged" />
        <Stat label="Store stock" value={money(g.store || 0, { compact: true })} sub={`${g.storeCount || 0} store lines`} />
        <Stat label="Total available" value={money(g.total || 0, { compact: true })} sub="feeds OTB" />
        <Stat label="Data through" value={summary.dataThrough ? dateLabel(summary.dataThrough) : "—"} sub={summary.loaded ? "as loaded" : "nothing loaded"} />
      </StatRow>

      {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12 }}>{message}</div>}

      <div style={{ ...card, display: "flex", gap: 3, padding: 4, background: "var(--raise)", flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => {
          const on = k === tab;
          return (
            <button key={k} onClick={() => setTab(k)} style={{
              fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 14px", borderRadius: 7, cursor: "pointer",
              background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
              color: on ? "var(--ink)" : "var(--muted)",
            }}>{l}</button>
          );
        })}
      </div>

      {tab === "SUMMARY"
        ? <Summary summary={summary} />
        : <LocationTab location={tab} positions={positions} canManage={canManage} busy={busy} op={op} onRefresh={() => router.refresh()} />}
    </div>
  );
}

// One management tab (In transit / DC / Stores).
function LocationTab({ location, positions, canManage, busy, op, onRefresh }) {
  const isTransit = location === "IN_TRANSIT";
  const isStore = location === "STORE";
  const isDc = location === "WAREHOUSE";
  const rows = useMemo(() => positions.filter((p) => p.location_type === location), [positions, location]);
  const title = isTransit ? "Stock in transit (Miniso only)" : isDc ? "Stock in the DC" : "Stock in the stores";
  const note = isTransit
    ? "Goods on the water from Miniso HQ — value is confidence-adjusted for arrival before it reduces OTB."
    : isDc ? "Warehouse stock; reserved and damaged are held back so only available stock reduces OTB."
    : "Every store's stock. OTB consolidates these to a single stores total — enter each store here.";
  const total = rows.reduce((t, r) => t + (Number(r.stock_value) || 0), 0);

  return (
    <>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.5 }}>{note}</div>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No {isStore ? "store" : isDc ? "DC" : "in-transit"} positions yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead><tr>
                <th style={th}>Channel</th>
                {isStore && <th style={th}>Store</th>}
                <th style={{ ...th, textAlign: "right" }}>Stock value</th>
                {isDc && <th style={{ ...th, textAlign: "right" }}>Reserved</th>}
                {isDc && <th style={{ ...th, textAlign: "right" }}>Damaged</th>}
                {isTransit && <th style={{ ...th, textAlign: "right" }}>Confidence</th>}
                <th style={th}>Data through</th>
                {canManage && <th style={th}></th>}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{CH_LABEL[r.channel_code] || r.channel_code}</td>
                    {isStore && <td style={td}>{r.store_code || "—"}{r.store_name ? ` · ${r.store_name}` : ""}</td>}
                    <td style={tdR}>{money(r.stock_value)}</td>
                    {isDc && <td style={tdR}>{money(r.reserved_value)}</td>}
                    {isDc && <td style={tdR}>{money(r.damaged_value)}</td>}
                    {isTransit && <td style={tdR}>{r.confidence == null ? "—" : `${Math.round(Number(r.confidence) * 100)}%`}</td>}
                    <td style={td}>{dateLabel(r.data_through)}</td>
                    {canManage && <td style={td}><button style={ghost} disabled={busy} onClick={() => { if (window.confirm("Remove this position?")) op({ op: "delete", id: r.id }, "Position removed."); }}>Remove</button></td>}
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ ...td, borderTop: "2px solid var(--line)" }} colSpan={isStore ? 2 : 1}>Total</td>
                  <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(total)}</td>
                  <td style={{ borderTop: "2px solid var(--line)" }} colSpan={(isDc ? 2 : isTransit ? 1 : 0) + 1 + (canManage ? 1 : 0)} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && <AddPosition location={location} busy={busy} op={op} />}
      {canManage && <Ingest busy={busy} op={op} />}
    </>
  );
}

function AddPosition({ location, busy, op }) {
  const isTransit = location === "IN_TRANSIT";
  const isStore = location === "STORE";
  const isDc = location === "WAREHOUSE";
  const empty = { channel_code: isTransit ? "MINISO_MDS" : "", store_code: "", store_name: "", stock_value: "", reserved_value: "", damaged_value: "", confidence: isTransit ? "0.9" : "", data_through: "" };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    const j = await op({ op: "save", row: { ...f, location_type: location } }, "Position saved.");
    if (j) setF(empty);
  }
  const chOpts = isTransit ? [["MINISO_MDS", "Miniso MDS"]] : CH;
  return (
    <div style={card}>
      <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 12 }}>Add / update a {isTransit ? "in-transit" : isDc ? "DC" : "store"} position</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        <Field label="Channel"><select style={inputSt} value={f.channel_code} onChange={set("channel_code")}>{!isTransit && <option value="">—</option>}{chOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        {isStore && <Field label="Store code"><input style={inputSt} value={f.store_code} onChange={set("store_code")} placeholder="e.g. ST001" /></Field>}
        {isStore && <Field label="Store name"><input style={inputSt} value={f.store_name} onChange={set("store_name")} placeholder="e.g. Westfield" /></Field>}
        <Field label="Stock value (£)"><input type="number" min="0" step="0.01" style={{ ...inputSt, textAlign: "right" }} value={f.stock_value} onChange={set("stock_value")} /></Field>
        {isDc && <Field label="Reserved (£)"><input type="number" min="0" step="0.01" style={{ ...inputSt, textAlign: "right" }} value={f.reserved_value} onChange={set("reserved_value")} /></Field>}
        {isDc && <Field label="Damaged (£)"><input type="number" min="0" step="0.01" style={{ ...inputSt, textAlign: "right" }} value={f.damaged_value} onChange={set("damaged_value")} /></Field>}
        {isTransit && <Field label="Arrival confidence (0–1)"><input type="number" min="0" max="1" step="0.01" style={{ ...inputSt, textAlign: "right" }} value={f.confidence} onChange={set("confidence")} /></Field>}
        <Field label="Data through"><input type="date" style={inputSt} value={f.data_through} onChange={set("data_through")} /></Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <button style={btn("var(--accent)")} disabled={busy || !f.channel_code || (isStore && !f.store_code) || f.stock_value === ""} onClick={submit}>{busy ? "Saving…" : "Save position"}</button>
      </div>
    </div>
  );
}

function Ingest({ busy, op }) {
  const fileRef = useRef(null);
  const [csv, setCsv] = useState("");
  async function ingest() { const j = await op({ op: "ingest", csv }, "Inventory ingested."); if (j) setCsv(""); }
  return (
    <div style={card}>
      <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 2 }}>Bulk upload (CSV)</div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 10, lineHeight: 1.6 }}>
        Columns: <span style={{ fontFamily: "var(--mono)" }}>Channel, Location, Store, Units, Stock value, Reserved, Damaged, Confidence, Data through</span>. Location is STORE / WAREHOUSE / IN_TRANSIT (in transit is Miniso only). Loads across all locations at once.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} style={{ fontSize: 12.5 }} />
        <a style={{ ...ghost, textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="inventory-template.csv">Template</a>
      </div>
      <textarea rows={4} style={{ ...inputSt, fontFamily: "var(--mono)", fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Channel,Location,Store,Units,Stock value,Reserved,Damaged,Confidence,Data through" />
      <div style={{ marginTop: 10 }}>
        <button style={btn("var(--accent)")} disabled={busy || !csv.trim()} onClick={ingest}>{busy ? "Ingesting…" : "Ingest inventory"}</button>
      </div>
    </div>
  );
}

// The consolidated topline that drives OTB — per channel × location + grand total.
function Summary({ summary }) {
  const channels = summary.channels || [];
  const g = summary.grand || {};
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Inventory summary — feeds OTB</div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.6 }}>
        The consolidated available position per channel. This is exactly what the OTB Inventory tab reads — stores rolled to a single total, warehouse net of reserved / damaged, in transit confidence-adjusted.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 560 }}>
          <thead><tr>
            <th style={th}>Channel</th>
            <th style={{ ...th, textAlign: "right" }}>In transit</th>
            <th style={{ ...th, textAlign: "right" }}>DC available</th>
            <th style={{ ...th, textAlign: "right" }}>Stores</th>
            <th style={{ ...th, textAlign: "right" }}>Total available</th>
          </tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.channel_code}>
                <td style={td}>{c.label}</td>
                <td style={tdR}>{money(c.IN_TRANSIT.available)}</td>
                <td style={tdR}>{money(c.WAREHOUSE.available)}</td>
                <td style={tdR}>{money(c.STORE.available)} <span style={{ color: "var(--faint)", fontSize: 11 }}>· {c.STORE.storeCount}</span></td>
                <td style={{ ...tdR, fontWeight: 600 }}>{money(c.totalAvailable)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={{ ...td, borderTop: "2px solid var(--line)" }}>Total</td>
              <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(g.inTransit || 0)}</td>
              <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(g.warehouse || 0)}</td>
              <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(g.store || 0)}</td>
              <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{money(g.total || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
