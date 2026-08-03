"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Stat, StatRow, Badge, EmptyState } from "../../finance-os/ui";

/* Merchandising Open-to-Buy workspace. A tabbed client shell over one OTB version:
   executive summary + computed Remaining OTB, the sales plan reconciliation, the
   inventory/register inputs, per-channel assumptions and the OTB-controlled
   procurement request flow. Styling follows the P.O tracker (inline styles on the
   shared CSS variables); every mutation posts to /api/otb and refreshes. */

// ---- format + style helpers (house style) ----
const gbp = (v) => (v == null || v === "" ? "—" : `£${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const mm = (v) => `£${(Number(v || 0) / 1_000_000).toFixed(1)}m`;
const dateLabel = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right" };

// ---- OTB domain constants ----
const OTB_COLS = [["MINISO_MDS", "Miniso MDS"], ["LOCAL_PURCHASE", "Local Purchase"]];
const SUMMARY_ROWS = [
  ["PLANNED_COS", "Planned cost of sales"],
  ["TARGET_CLOSING_STOCK", "Target closing stock"],
  ["NEW_STORE", "New-store opening stock"],
  ["FITOUT", "Fit-out inventory"],
  ["OPENING_STORE_STOCK", "Store stock on hand"],
  ["OPENING_WAREHOUSE_STOCK", "Warehouse stock"],
  ["IN_TRANSIT", "Stock in transit"],
  ["CLOSURE_TRANSFERABLE", "Transferable closure stock"],
  ["CLEARANCE_REDUCTION", "Clearance reduction"],
  ["OPEN_COMMITMENTS", "Open commitments"],
  ["APPROVED_REQUESTS", "Approved requests"],
];
const SUBTRACTING = new Set(["OPENING_STORE_STOCK", "OPENING_WAREHOUSE_STOCK", "IN_TRANSIT", "CLOSURE_TRANSFERABLE", "CLEARANCE_REDUCTION", "OPEN_COMMITMENTS", "APPROVED_REQUESTS"]);

const TOL_TONE = { WITHIN_TOLERANCE: "green", WARNING: "amber", OUTSIDE_TOLERANCE: "red", APPROVED_EXCEPTION: "accent" };
const VAL_TONE = { WITHIN_OTB: "green", OTB_WARNING: "amber", EXCEEDS_OTB: "red", NO_APPROVED_OTB: "muted", APPROVED_EXCEPTION: "accent" };
const STATUS_TONE = { DRAFT: "muted", APPROVED: "green", LOCKED: "accent", ARCHIVED: "muted" };

const TABS = [
  ["summary", "Executive summary"],
  ["sales", "Sales plan"],
  ["inventory", "Inventory"],
  ["newstores", "New stores"],
  ["closures", "Closures"],
  ["clearance", "Clearance"],
  ["assumptions", "Assumptions"],
  ["validation", "Validation"],
  ["history", "Approval history"],
];

// A compact self-managed add-row form. fields: [{ key, label, type, options?, placeholder?, step? }].
function RowForm({ fields, submitLabel, onSubmit, busy }) {
  const seed = () => Object.fromEntries(fields.map((f) => [f.key, f.type === "checkbox" ? false : ""]));
  const [f, setF] = useState(seed);
  const set = (k, type) => (e) => setF((s) => ({ ...s, [k]: type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); const ok = await onSubmit(f); if (ok) setF(seed()); }}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, alignItems: "end", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}
    >
      {fields.map((fd) => (
        <label key={fd.key} style={fd.type === "checkbox" ? { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } : field}>
          {fd.type === "checkbox" ? (
            <><input type="checkbox" checked={!!f[fd.key]} onChange={set(fd.key, "checkbox")} /><span>{fd.label}</span></>
          ) : (
            <>
              <span style={labelSt}>{fd.label}</span>
              {fd.type === "select" ? (
                <select style={inputSt} value={f[fd.key]} onChange={set(fd.key)}>
                  <option value="">—</option>
                  {(fd.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input style={inputSt} type={fd.type || "text"} step={fd.step} placeholder={fd.placeholder} value={f[fd.key]} onChange={set(fd.key)} />
              )}
            </>
          )}
        </label>
      ))}
      <button type="submit" disabled={busy} style={{ ...btn("var(--accent)"), height: "fit-content" }}>{submitLabel}</button>
    </form>
  );
}

export default function OtbWorkspace({ versions = [], channels = [], version, detail, requests = [], canApprove = false, isAdmin = false, isFinance = false }) {
  const router = useRouter();
  const [tab, setTab] = useState("summary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const channelOpts = useMemo(
    () => (channels.length ? channels.map((c) => [c.channel_code, c.channel_name || c.channel_code]) : OTB_COLS),
    [channels]
  );
  const vid = version?.otb_version_id;

  // The one POST helper: every mutation reports {error} on failure and refreshes on success.
  async function run(url, body, { refresh = true, note } = {}) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (note) setMsg(note);
      if (refresh) router.refresh();
      return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }
  const otbOp = (body, note) => run(`/api/otb/${vid}`, body, { note });

  function onVersionChange(e) {
    const id = e.target.value;
    router.push(id ? `/plan/otb?v=${id}` : "/plan/otb");
  }

  return (
    <div>
      {/* ---- header + version controls ---- */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "0.5rem 0 1.4rem", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ ...labelSt, marginBottom: 7 }}>Plan · Merchandising</div>
          <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em", lineHeight: 1.15 }}>Open-to-Buy workspace</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select style={{ ...inputSt, minWidth: 220 }} value={vid || ""} onChange={onVersionChange}>
            {!versions.length && <option value="">No OTB versions</option>}
            {versions.map((v) => <option key={v.otb_version_id} value={v.otb_version_id}>{v.label}{v.fiscal_year ? ` · FY${v.fiscal_year}` : ""} ({v.status})</option>)}
          </select>
          <button style={ghost} onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "Create OTB version"}</button>
        </div>
      </header>

      {showCreate && (
        <div style={card}>
          <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>New OTB version</div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6 }}>A version snapshots the plan, its assumptions and registers. Choose where approved store sales come from for reconciliation.</div>
          <RowForm
            busy={busy}
            submitLabel="Create version"
            fields={[
              { key: "label", label: "Label", placeholder: "e.g. FY26 OTB — Base" },
              { key: "fiscal_year", label: "Fiscal year", type: "number", placeholder: "2026" },
              { key: "sales_source", label: "Sales source", type: "select", options: [["MANUAL", "Manual"], ["PLANNING", "Planning engine"], ["FORECAST_VERSION", "Forecast version"]] },
              { key: "scenario_code", label: "Scenario", placeholder: "BASE" },
            ]}
            onSubmit={async (form) => {
              const j = await run("/api/otb", form, { refresh: false });
              if (j && j.otbVersionId) { router.push(`/plan/otb?v=${j.otbVersionId}`); return true; }
              return false;
            }}
          />
        </div>
      )}

      {/* ---- version status strip ---- */}
      {version && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
          <Badge tone={STATUS_TONE[version.status] || "muted"}>{version.status}</Badge>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Sales source: <strong style={{ color: "var(--ink)" }}>{version.sales_source}</strong></span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>· Inventory through: <strong style={{ color: "var(--ink)" }}>{version.inventory_through ? dateLabel(version.inventory_through) : "not loaded"}</strong></span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>· Scenario: <strong style={{ color: "var(--ink)" }}>{version.scenario_code || "BASE"}</strong></span>
        </div>
      )}

      {(error || msg) && (
        <div style={{ marginBottom: 14, fontSize: 13, color: error ? "var(--red)" : "var(--green)" }}>{error || msg}</div>
      )}

      {!version ? (
        <EmptyState title="Start your first Open-to-Buy plan">
          Create an OTB version with the button above — then set your sales, assumptions and stock position, and the workspace computes the remaining Open-to-Buy for Miniso MDS and Local Purchase across every component.
        </EmptyState>
      ) : (
        <>
          {/* ---- tab bar ---- */}
          <div style={{ display: "inline-flex", gap: 3, marginBottom: 22, flexWrap: "wrap", padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
            {TABS.map(([k, label]) => {
              const on = k === tab;
              return (
                <button key={k} onClick={() => setTab(k)} style={{
                  fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 7, cursor: "pointer",
                  background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line)" : "transparent"}`,
                  color: on ? "var(--ink)" : "var(--muted)",
                }}>{label}</button>
              );
            })}
          </div>

          {tab === "summary" && <ExecutiveSummary version={version} detail={detail} onCompute={() => otbOp({ op: "compute" }, "OTB computed.")} busy={busy} />}
          {tab === "sales" && <SalesPlan detail={detail} />}
          {tab === "inventory" && <Inventory detail={detail} version={version} onIngest={(csv) => otbOp({ op: "ingest-inventory", csv }, "Inventory ingested.")} busy={busy} />}
          {tab === "newstores" && <NewStores detail={detail} channelOpts={channelOpts} busy={busy} onSave={(row) => otbOp({ op: "save-newstore", row }, "New store saved.")} />}
          {tab === "closures" && <Closures detail={detail} channelOpts={channelOpts} busy={busy} onSave={(row) => otbOp({ op: "save-closure", row }, "Closure saved.")} />}
          {tab === "clearance" && <Clearance detail={detail} channelOpts={channelOpts} busy={busy} onSave={(row) => otbOp({ op: "save-clearance", row }, "Clearance plan saved.")} />}
          {tab === "assumptions" && <Assumptions detail={detail} channelOpts={channelOpts} busy={busy}
            onSaveAssumption={(assumption) => otbOp({ op: "save-assumption", assumption }, "Assumptions saved.")}
            onSaveMinStock={(row) => otbOp({ op: "save-minstock", row }, "Min-stock rule saved.")} />}
          {tab === "validation" && <Validation requests={requests} detail={detail} />}
          {tab === "history" && <History version={version} detail={detail} canApprove={canApprove} busy={busy}
            onAction={(op) => otbOp({ op }, `Version ${op}.`)} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Executive summary + OTB table
// ---------------------------------------------------------------------------
function ExecutiveSummary({ version, detail, onCompute, busy }) {
  const summary = detail?.summary || { byChannel: {}, total: {}, computed: false };
  const rec = detail?.reconciliation || { ready: false, stores: [] };
  const total = summary.total || {};
  const remMds = summary.byChannel?.MINISO_MDS?.REMAINING_OTB || 0;
  const remLocal = summary.byChannel?.LOCAL_PURCHASE?.REMAINING_OTB || 0;
  const remTotal = total.REMAINING_OTB || 0;

  const stores = rec.stores || [];
  const outside = stores.filter((s) => s.status === "OUTSIDE_TOLERANCE").length;
  const warn = stores.filter((s) => s.status === "WARNING").length;
  const recTone = !stores.length ? "muted" : outside ? "red" : warn ? "amber" : "green";
  const recLabel = !stores.length ? "No splits" : outside ? `${outside} outside tolerance` : warn ? `${warn} warning` : "All within tolerance";

  const cell = (v, code) => {
    if (v == null) return <span style={{ color: "var(--faint)" }}>—</span>;
    const sub = SUBTRACTING.has(code);
    return <span style={{ color: sub ? "var(--muted)" : "var(--ink)" }}>{sub ? `(${gbp(Math.abs(v))})` : gbp(v)}</span>;
  };

  return (
    <div>
      <StatRow>
        <Stat label="Remaining OTB · Miniso MDS" value={mm(remMds)} sub={gbp(remMds)} tone={remMds < 0 ? "red" : undefined} />
        <Stat label="Remaining OTB · Local Purchase" value={mm(remLocal)} sub={gbp(remLocal)} tone={remLocal < 0 ? "red" : undefined} />
        <Stat label="Total Remaining OTB" value={mm(remTotal)} sub={gbp(remTotal)} tone={remTotal < 0 ? "red" : undefined} />
        <Stat label="Sales reconciliation" value={recLabel} sub={rec.ready ? `Source: ${rec.salesSource || "—"}` : "Not reconciled"} tone={recTone} />
        <Stat label="Inventory data through" value={version.inventory_through ? dateLabel(version.inventory_through) : "—"} sub={version.inventory_through ? "As uploaded" : "Not loaded"} />
      </StatRow>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>OTB summary</div>
            <div style={{ fontSize: 12, color: "var(--faint)" }}>Computed separately per purchase channel. Bracketed rows reduce the purchasing requirement. {summary.computed ? "" : "Not yet computed — press Compute OTB."}</div>
          </div>
          <button style={btn("var(--accent)")} disabled={busy} onClick={onCompute}>{busy ? "Working…" : "Compute OTB"}</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={th}>Component</th>
                {OTB_COLS.map(([c, l]) => <th key={c} style={{ ...th, textAlign: "right" }}>{l}</th>)}
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY_ROWS.map(([code, label]) => (
                <tr key={code}>
                  <td style={td}>{label}</td>
                  {OTB_COLS.map(([c]) => <td key={c} style={tdR}>{cell(summary.byChannel?.[c]?.[code], code)}</td>)}
                  <td style={tdR}>{cell(total[code], code)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...td, borderTop: "2px solid var(--line)" }}>Remaining OTB</td>
                {OTB_COLS.map(([c]) => {
                  const v = summary.byChannel?.[c]?.REMAINING_OTB;
                  return <td key={c} style={{ ...tdR, borderTop: "2px solid var(--line)", color: v < 0 ? "var(--red)" : "var(--ink)" }}>{v == null ? "—" : gbp(v)}</td>;
                })}
                <td style={{ ...tdR, borderTop: "2px solid var(--line)", color: remTotal < 0 ? "var(--red)" : "var(--ink)" }}>{gbp(remTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <MonthlyOtb monthly={detail?.monthly} />
    </div>
  );
}

// The whole-horizon OTB pool, spread month by month across an 18-month projection.
// Each month's Open-to-Buy is the classic retail roll: planned cost of sales + the
// change in target stock cover, net of stock on hand / committed and the month's
// store-opening / closure / clearance events (see projectChannelOtb, otb-rules).
function MonthlyOtb({ monthly }) {
  const m = monthly || {};
  const rows = m.total || [];
  const ymLabel = (p) => { const x = /^(\d{4})-(\d{2})$/.exec(p || ""); return x ? new Date(Date.UTC(+x[1], +x[2] - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : (p || "—"); };
  const mds = (i) => m.byChannel?.MINISO_MDS?.months?.[i]?.otb;
  const local = (i) => m.byChannel?.LOCAL_PURCHASE?.months?.[i]?.otb;
  return (
    <div style={card}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Monthly OTB — 18-month projection</div>
        <div style={{ fontSize: 12, color: "var(--faint)" }}>
          {m.ready && m.computed
            ? <>The executive OTB pool spread across the calendar from {ymLabel(m.start)}. Each month = planned cost of sales + the change in target stock cover, net of stock on hand, commitments and store events.</>
            : "Not yet available — enter the monthly sales plan and channel assumptions (COS %, target stock weeks), then Compute OTB."}
        </div>
      </div>
      {m.ready && m.computed && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>Month</th>
                <th style={{ ...th, textAlign: "right" }}>Planned sales</th>
                <th style={{ ...th, textAlign: "right" }}>Cost of sales</th>
                <th style={{ ...th, textAlign: "right" }}>Miniso MDS OTB</th>
                <th style={{ ...th, textAlign: "right" }}>Local OTB</th>
                <th style={{ ...th, textAlign: "right" }}>Total OTB</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.period}>
                  <td style={td}>{ymLabel(r.period)}</td>
                  <td style={tdR}>{gbp(r.sales)}</td>
                  <td style={tdR}>{gbp(r.plannedCos)}</td>
                  <td style={{ ...tdR, color: mds(i) < 0 ? "var(--red)" : "var(--muted)" }}>{mds(i) == null ? "—" : gbp(mds(i))}</td>
                  <td style={{ ...tdR, color: local(i) < 0 ? "var(--red)" : "var(--muted)" }}>{local(i) == null ? "—" : gbp(local(i))}</td>
                  <td style={{ ...tdR, fontWeight: 600, color: r.otb < 0 ? "var(--red)" : "var(--ink)" }}>{gbp(r.otb)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...td, borderTop: "2px solid var(--line)" }}>18-month total</td>
                <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{gbp(rows.reduce((t, r) => t + r.sales, 0))}</td>
                <td style={{ ...tdR, borderTop: "2px solid var(--line)" }}>{gbp(rows.reduce((t, r) => t + r.plannedCos, 0))}</td>
                <td style={{ ...tdR, borderTop: "2px solid var(--line)", color: "var(--muted)" }}>{gbp(m.byChannel?.MINISO_MDS?.totalOtb || 0)}</td>
                <td style={{ ...tdR, borderTop: "2px solid var(--line)", color: "var(--muted)" }}>{gbp(m.byChannel?.LOCAL_PURCHASE?.totalOtb || 0)}</td>
                <td style={{ ...tdR, borderTop: "2px solid var(--line)", color: (m.totalOtb || 0) < 0 ? "var(--red)" : "var(--ink)" }}>{gbp(m.totalOtb || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Sales plan reconciliation
// ---------------------------------------------------------------------------
function SalesPlan({ detail }) {
  const rec = detail?.reconciliation || { ready: false, stores: [] };
  const stores = rec.stores || [];
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Sales plan reconciliation</div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12 }}>Channel splits reconciled to approved store sales, per store, within tolerance. Sales source: <strong>{rec.salesSource || "—"}</strong>.</div>
      {!stores.length ? (
        <div style={{ fontSize: 13, color: "var(--faint)" }}>No store sales splits entered for this version yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead><tr>{["Store", "Miniso MDS", "Local Purchase", "Total split", "Approved sales", "Diff", "Diff %", "Status"].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.store_code}>
                  <td style={td}>{s.store_code}</td>
                  <td style={tdR}>{gbp(s.channelAmounts?.MINISO_MDS || 0)}</td>
                  <td style={tdR}>{gbp(s.channelAmounts?.LOCAL_PURCHASE || 0)}</td>
                  <td style={tdR}>{gbp(s.otbTotal)}</td>
                  <td style={tdR}>{gbp(s.approvedStoreSales)}</td>
                  <td style={{ ...tdR, color: Math.abs(s.diff) < 0.5 ? "var(--ink)" : "var(--amber)" }}>{gbp(s.diff)}</td>
                  <td style={tdR}>{s.diffPct == null ? "—" : `${s.diffPct}%`}</td>
                  <td style={{ ...td, textAlign: "right" }}><Badge tone={TOL_TONE[s.status] || "muted"}>{(s.status || "").replace(/_/g, " ")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Inventory (store / warehouse / in-transit) + CSV ingest
// ---------------------------------------------------------------------------
function Inventory({ detail, version, onIngest, busy }) {
  const rows = detail?.inventory || [];
  const [csv, setCsv] = useState("");
  const groups = [["STORE", "Store stock"], ["WAREHOUSE", "Warehouse stock"], ["IN_TRANSIT", "Stock in transit"]];
  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>Upload inventory position</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 10, lineHeight: 1.6 }}>
          Paste CSV or choose a file. Columns: <span style={{ fontFamily: "var(--mono)" }}>Channel, Location, Store, Units, Stock value, Reserved, Damaged, Confidence, Data through</span>.
          Location is one of STORE / WAREHOUSE / IN_TRANSIT.
        </div>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} style={{ fontSize: 12.5, marginBottom: 10 }} />
        <textarea rows={5} style={{ ...inputSt, width: "100%", fontFamily: "var(--mono)", fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Channel,Location,Store,Units,Stock value,Reserved,Damaged,Confidence,Data through" />
        <div style={{ marginTop: 10 }}>
          <button style={btn("var(--accent)")} disabled={busy || !csv.trim()} onClick={() => onIngest(csv)}>{busy ? "Ingesting…" : "Ingest inventory"}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Inventory positions {version.inventory_through ? `· through ${dateLabel(version.inventory_through)}` : ""}</div>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No inventory loaded for this version yet.</div>
        ) : groups.map(([type, title]) => {
          const g = rows.filter((r) => r.location_type === type);
          if (!g.length) return null;
          return (
            <div key={type} style={{ marginBottom: 18 }}>
              <div style={{ ...labelSt, marginBottom: 8 }}>{title} · {g.length}</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
                  <thead><tr>{["Channel", "Store", "Stock value", "Reserved", "Damaged", "Confidence", "Data through"].map((h, i) => (
                    <th key={h} style={{ ...th, textAlign: i >= 2 && i <= 5 ? "right" : "left" }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {g.map((r) => (
                      <tr key={r.id}>
                        <td style={td}>{r.channel_code}</td>
                        <td style={td}>{r.store_code || "—"}</td>
                        <td style={tdR}>{gbp(r.stock_value)}</td>
                        <td style={tdR}>{gbp(r.reserved_value)}</td>
                        <td style={tdR}>{gbp(r.damaged_value)}</td>
                        <td style={tdR}>{r.confidence == null ? "—" : `${Math.round(Number(r.confidence) * 100)}%`}</td>
                        <td style={td}>{r.data_through ? dateLabel(r.data_through) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — New stores
// ---------------------------------------------------------------------------
function NewStores({ detail, channelOpts, onSave, busy }) {
  const rows = detail?.newStores || [];
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>New-store opening requirements</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
          <thead><tr>{["Store", "Name", "Opening", "Channel", "Opening stock", "Fit-out", "Phase", "Approved"].map((h, i) => (
            <th key={h} style={{ ...th, textAlign: i >= 4 && i <= 5 ? "right" : "left" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td style={td} colSpan={8}><span style={{ color: "var(--faint)" }}>No new stores yet.</span></td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.store_code || "—"}</td>
                  <td style={td}>{r.store_name || "—"}</td>
                  <td style={td}>{r.planned_opening ? dateLabel(r.planned_opening) : "—"}</td>
                  <td style={td}>{r.channel_code}</td>
                  <td style={tdR}>{gbp(r.opening_stock_value)}</td>
                  <td style={tdR}>{gbp(r.fitout_inventory_value)}</td>
                  <td style={td}>{r.phase || "—"}</td>
                  <td style={td}><Badge tone={r.approved ? "green" : "muted"}>{r.approved ? "Approved" : "Draft"}</Badge></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <RowForm
        busy={busy}
        submitLabel="Save new store"
        fields={[
          { key: "store_code", label: "Store code" },
          { key: "store_name", label: "Store name" },
          { key: "planned_opening", label: "Planned opening", type: "date" },
          { key: "channel_code", label: "Channel", type: "select", options: channelOpts },
          { key: "opening_stock_value", label: "Opening stock (£)", type: "number", step: "0.01" },
          { key: "fitout_inventory_value", label: "Fit-out (£)", type: "number", step: "0.01" },
          { key: "phase", label: "Phase", placeholder: "INITIAL" },
          { key: "approved", label: "Approved", type: "checkbox" },
        ]}
        onSubmit={async (row) => !!(await onSave(row))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Store closures
// ---------------------------------------------------------------------------
function Closures({ detail, channelOpts, onSave, busy }) {
  const rows = detail?.closures || [];
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Store closures</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
          <thead><tr>{["Store", "Closure date", "Channel", "Current stock", "Transferable", "Non-transferable", "Write-off"].map((h, i) => (
            <th key={h} style={{ ...th, textAlign: i >= 3 ? "right" : "left" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td style={td} colSpan={7}><span style={{ color: "var(--faint)" }}>No closures yet.</span></td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.store_code || "—"}</td>
                  <td style={td}>{r.closure_date ? dateLabel(r.closure_date) : "—"}</td>
                  <td style={td}>{r.channel_code}</td>
                  <td style={tdR}>{gbp(r.current_stock_value)}</td>
                  <td style={tdR}>{gbp(r.transferable_value)}</td>
                  <td style={tdR}>{gbp(r.non_transferable_value)}</td>
                  <td style={tdR}>{gbp(r.write_off_value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <RowForm
        busy={busy}
        submitLabel="Save closure"
        fields={[
          { key: "store_code", label: "Store code" },
          { key: "closure_date", label: "Closure date", type: "date" },
          { key: "channel_code", label: "Channel", type: "select", options: channelOpts },
          { key: "current_stock_value", label: "Current stock (£)", type: "number", step: "0.01" },
          { key: "transferable_value", label: "Transferable (£)", type: "number", step: "0.01" },
          { key: "non_transferable_value", label: "Non-transferable (£)", type: "number", step: "0.01" },
          { key: "write_off_value", label: "Write-off (£)", type: "number", step: "0.01" },
        ]}
        onSubmit={async (row) => !!(await onSave(row))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Clearance
// ---------------------------------------------------------------------------
function Clearance({ detail, channelOpts, onSave, busy }) {
  const rows = detail?.clearance || [];
  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Clearance plans</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
          <thead><tr>{["Location", "Channel", "Category", "Stock value", "Realisation", "Status"].map((h, i) => (
            <th key={h} style={{ ...th, textAlign: i >= 3 && i <= 4 ? "right" : "left" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td style={td} colSpan={6}><span style={{ color: "var(--faint)" }}>No clearance plans yet.</span></td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.location || "—"}</td>
                  <td style={td}>{r.channel_code}</td>
                  <td style={td}>{r.category || "—"}</td>
                  <td style={tdR}>{gbp(r.stock_value)}</td>
                  <td style={tdR}>{r.realisation_rate == null ? "—" : `${Math.round(Number(r.realisation_rate) * 100)}%`}</td>
                  <td style={td}><Badge tone="muted">{r.status || "PLANNED"}</Badge></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <RowForm
        busy={busy}
        submitLabel="Save clearance"
        fields={[
          { key: "location", label: "Location" },
          { key: "channel_code", label: "Channel", type: "select", options: channelOpts },
          { key: "category", label: "Category" },
          { key: "stock_value", label: "Stock value (£)", type: "number", step: "0.01" },
          { key: "realisation_rate", label: "Realisation (0-1)", type: "number", step: "0.01", placeholder: "0.7" },
          { key: "status", label: "Status", placeholder: "PLANNED" },
        ]}
        onSubmit={async (row) => !!(await onSave(row))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Assumptions + min-stock rules
// ---------------------------------------------------------------------------
function Assumptions({ detail, channelOpts, onSaveAssumption, onSaveMinStock, busy }) {
  const existing = detail?.assumptions || [];
  const minStock = detail?.minStock || [];
  const byCh = Object.fromEntries(existing.map((a) => [a.channel_code, a]));

  const cards = channelOpts.map(([code, label]) => ({ code, label, a: byCh[code] || {} }));
  const [forms, setForms] = useState(() =>
    Object.fromEntries(cards.map((c) => [c.code, {
      channel_code: c.code,
      cos_rate: c.a.cos_rate ?? "", gross_margin_rate: c.a.gross_margin_rate ?? "", freight_pct: c.a.freight_pct ?? "",
      duty_pct: c.a.duty_pct ?? "", fx_rate: c.a.fx_rate ?? "", target_stock_weeks: c.a.target_stock_weeks ?? "",
      clearance_realisation: c.a.clearance_realisation ?? "", transit_confidence: c.a.transit_confidence ?? "", tolerance_pct: c.a.tolerance_pct ?? "",
    }]))
  );
  const set = (code, key) => (e) => setForms((s) => ({ ...s, [code]: { ...s[code], [key]: e.target.value } }));

  const numFields = [
    ["cos_rate", "COS rate (0-1)"], ["gross_margin_rate", "Gross margin (0-1)"], ["freight_pct", "Freight %"],
    ["duty_pct", "Duty %"], ["fx_rate", "FX rate"], ["target_stock_weeks", "Target stock weeks"],
    ["clearance_realisation", "Clearance realisation"], ["transit_confidence", "Transit confidence"], ["tolerance_pct", "Tolerance %"],
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16, marginBottom: 20 }}>
        {cards.map((c) => (
          <div key={c.code} style={card}>
            <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12 }}>Set COS rate or gross margin (one drives planned cost of sales).</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
              {numFields.map(([k, lbl]) => (
                <label key={k} style={field}><span style={labelSt}>{lbl}</span>
                  <input type="number" step="0.0001" style={inputSt} value={forms[c.code][k]} onChange={set(c.code, k)} />
                </label>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button style={btn("var(--accent)")} disabled={busy} onClick={() => onSaveAssumption(forms[c.code])}>{busy ? "Saving…" : "Save assumptions"}</button>
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Minimum stock rules</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
            <thead><tr>{["Level", "Match", "Channel", "Basis", "Amount"].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 4 ? "right" : "left" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {!minStock.length ? <tr><td style={td} colSpan={5}><span style={{ color: "var(--faint)" }}>No min-stock rules.</span></td></tr> :
                minStock.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.level}</td>
                    <td style={td}>{r.match_value || "—"}</td>
                    <td style={td}>{r.channel_code || "All"}</td>
                    <td style={td}>{r.basis}</td>
                    <td style={tdR}>{gbp(r.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <RowForm
          busy={busy}
          submitLabel="Save rule"
          fields={[
            { key: "level", label: "Level", placeholder: "STORE / CHANNEL / GLOBAL" },
            { key: "match_value", label: "Match value" },
            { key: "channel_code", label: "Channel", type: "select", options: channelOpts },
            { key: "basis", label: "Basis", placeholder: "VALUE / WEEKS" },
            { key: "amount", label: "Amount", type: "number", step: "0.01" },
          ]}
          onSubmit={async (row) => !!(await onSaveMinStock(row))}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 9 — Validation
// ---------------------------------------------------------------------------
function Validation({ requests, detail }) {
  const flagged = requests.filter((r) => r.validation_status === "EXCEEDS_OTB" || r.validation_status === "OTB_WARNING");
  const outside = (detail?.reconciliation?.stores || []).filter((s) => s.status === "OUTSIDE_TOLERANCE");
  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Requests over / near OTB</div>
        {!flagged.length ? <div style={{ fontSize: 13, color: "var(--green)" }}>No requests exceed or approach the OTB ceiling.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead><tr>{["Channel", "Supplier", "Amount", "Status"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 2 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {flagged.map((r) => (
                  <tr key={r.purchase_id}>
                    <td style={td}>{r.channel_code}</td>
                    <td style={td}>{r.supplier}</td>
                    <td style={tdR}>{gbp(r.amount_gbp)}</td>
                    <td style={td}><Badge tone={VAL_TONE[r.validation_status] || "muted"}>{r.validation_status.replace(/_/g, " ")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Stores outside sales tolerance</div>
        {!outside.length ? <div style={{ fontSize: 13, color: "var(--green)" }}>All reconciled stores are within tolerance.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead><tr>{["Store", "Split total", "Approved", "Diff %"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
              <tbody>
                {outside.map((s) => (
                  <tr key={s.store_code}>
                    <td style={td}>{s.store_code}</td>
                    <td style={tdR}>{gbp(s.otbTotal)}</td>
                    <td style={tdR}>{gbp(s.approvedStoreSales)}</td>
                    <td style={{ ...tdR, color: "var(--red)" }}>{s.diffPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 10 — Approval history + transfers
// ---------------------------------------------------------------------------
function History({ version, detail, canApprove, onAction, busy }) {
  const transfers = detail?.transfers || [];
  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 8 }}>Version status</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <Badge tone={STATUS_TONE[version.status] || "muted"}>{version.status}</Badge>
          {version.approved_by && <span style={{ fontSize: 12, color: "var(--muted)" }}>Approved by {version.approved_by}{version.approved_at ? ` · ${dateLabel(version.approved_at)}` : ""}</span>}
        </div>
        {canApprove ? (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={btn("var(--green)")} disabled={busy || version.status !== "DRAFT"} onClick={() => onAction("approve")}>Approve</button>
            <button style={btn("var(--accent)")} disabled={busy || version.status === "LOCKED"} onClick={() => onAction("lock")}>Lock</button>
            <button style={ghost} disabled={busy || version.status === "DRAFT"} onClick={() => onAction("reopen")}>Reopen</button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 8 }}>Approve / lock / reopen is a Finance or admin action.</div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Channel transfers</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
            <thead><tr>{["From", "To", "Period", "Amount", "Status"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 3 ? "right" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {!transfers.length ? <tr><td style={td} colSpan={5}><span style={{ color: "var(--faint)" }}>No channel transfers.</span></td></tr> :
                transfers.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>{t.from_channel}</td>
                    <td style={td}>{t.to_channel}</td>
                    <td style={td}>{t.period || "—"}</td>
                    <td style={tdR}>{gbp(t.amount)}</td>
                    <td style={td}><Badge tone="muted">{t.status}</Badge></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
