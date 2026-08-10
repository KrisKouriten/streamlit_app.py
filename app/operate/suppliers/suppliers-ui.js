"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, StatRow, Stat, Badge, money } from "../../finance-os/ui";
import MoneyInput from "../../money-input";
import { SUPPLIER_SOURCE_TYPES } from "../../../lib/suppliers-rules";

/* Suppliers & Credit — client. Reads the exposure report, facility limits and
   the HSBC facility position from the server page and drives /api/suppliers
   (supplier upsert + facility-limit). House style: inline styles on CSS vars,
   no framework. The page already gates on ADMIN/FINANCE, so the UI assumes
   manage rights. All money via the shared `money` helper; utilisation is a
   fraction (0.95 → "95.0%"). */

const pct = (n, dp = 1) => (n == null ? "—" : (Number(n) * 100).toFixed(dp) + "%");

const TONE_FG = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", muted: "var(--muted)" };

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };

// The row/utilisation tone: over the limit is red, near (≥90%, still within) amber.
const rowTone = (r) => (r.over ? "red" : r.near ? "amber" : null);

const EMPTY_NEW = { name: "", source_type: "", credit_limit: "", payment_days: "", active: true, active_merch: true };

export default function SuppliersUI({ exposure, facilityLimits = [], hsbc = null, suppliers = [] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const rows = exposure?.rows || [];
  const totals = exposure?.totals || {};

  // One POST helper: on !ok surface {error}; on ok refresh the server data.
  async function post(body, { note } = {}) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (note) setMsg(note);
      router.refresh();
      return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      <FacilityCard hsbc={hsbc} facilityLimits={facilityLimits} post={post} busy={busy} />

      <ExposureTable rows={rows} totals={totals} />

      <ManageSuppliers suppliers={suppliers} post={post} busy={busy} />
    </div>
  );
}

/* ---------------- HSBC facility position ---------------- */
function FacilityCard({ hsbc, facilityLimits, post, busy }) {
  const fac = hsbc || {};
  const notes = (facilityLimits.find((l) => l.facility === "HSBC") || {}).notes || "";
  const [limit, setLimit] = useState(fac.limit == null ? "" : String(fac.limit));

  function saveLimit() {
    post({ op: "facility-limit", facility: "HSBC", limit_gbp: limit === "" ? null : Number(limit), notes }, { note: "HSBC facility limit saved." });
  }

  return (
    <Panel title="HSBC facility position" note="the trade-facility ceiling vs total GBP drawings">
      <StatRow>
        <Stat label="Facility limit" value={money(fac.limit)} />
        <Stat label="Drawn" value={money(fac.exposure)} sub="facility outstanding" />
        <Stat label="Headroom" value={money(fac.headroom)} tone={fac.over ? "red" : fac.headroom == null ? undefined : "green"} />
        <Stat label="Utilisation" value={pct(fac.utilisation)} tone={fac.over ? "red" : fac.near ? "amber" : undefined} />
      </StatRow>

      <div style={{ ...card, display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 0 }}>
        <label style={{ ...field, minWidth: 200 }}>
          <span style={labelSt}>Set facility limit (£)</span>
          <MoneyInput style={inputSt} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 5,000,000" />
        </label>
        <button style={btn("var(--accent)")} disabled={busy} onClick={saveLimit}>{busy ? "Working…" : "Save limit"}</button>
        {fac.over && <span style={{ fontSize: 12.5, color: "var(--red)", paddingBottom: 8 }}>Over the facility ceiling.</span>}
      </div>
    </Panel>
  );
}

/* ---------------- Supplier orders vs credit limit ---------------- */
function ExposureTable({ rows, totals }) {
  return (
    <Panel title="Supplier orders vs credit limit" note="open order commitment + facility outstanding, matched on supplier name">
      {!rows.length ? (
        <div style={{ fontSize: 13, color: "var(--faint)" }}>No suppliers in the master yet.</div>
      ) : (
        <div className="fos-card" style={{ padding: "4px 6px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
            <thead><tr>
              <th style={th}>Supplier</th>
              {["Order commitment", "Facility outstanding", "Total exposure", "Credit limit", "Headroom", "Utilisation"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const tone = rowTone(r);
                const fg = tone ? TONE_FG[tone] : "var(--ink)";
                return (
                  <tr key={r.supplier_id}>
                    <td style={{ ...td, fontWeight: 600, color: fg, whiteSpace: "normal" }}>
                      {r.name}
                      {r.over && <span style={{ marginLeft: 8 }}><Badge tone="red">Over</Badge></span>}
                      {!r.over && r.near && <span style={{ marginLeft: 8 }}><Badge tone="amber">Near</Badge></span>}
                    </td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(r.orderExposure)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{money(r.facilityOutstanding)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(r.exposure)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{r.limit == null ? "—" : money(r.limit)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", color: r.limit == null ? "var(--ink)" : fg }}>{r.limit == null ? "—" : money(r.headroom)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", color: fg, fontWeight: tone ? 700 : 500 }}>{pct(r.utilisation)}</td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr>
                <td style={{ ...td, borderBottom: "none", borderTop: "1px solid var(--line)", fontWeight: 700 }}>
                  Total <span style={{ fontWeight: 400, color: "var(--faint)", fontSize: 12 }}>· {totals.suppliers ?? rows.length} suppliers · {totals.withLimit ?? 0} with a limit</span>
                </td>
                <td style={{ ...td, borderBottom: "none", borderTop: "1px solid var(--line)" }} />
                <td style={{ ...td, borderBottom: "none", borderTop: "1px solid var(--line)" }} />
                <td className="fos-num" style={{ ...td, textAlign: "right", borderBottom: "none", borderTop: "1px solid var(--line)", fontWeight: 700 }}>{money(totals.totalExposure)}</td>
                <td className="fos-num" style={{ ...td, textAlign: "right", borderBottom: "none", borderTop: "1px solid var(--line)", fontWeight: 700 }}>{money(totals.totalLimit)}</td>
                <td className="fos-num" style={{ ...td, textAlign: "right", borderBottom: "none", borderTop: "1px solid var(--line)", fontWeight: 700, color: (totals.totalHeadroom ?? 0) < 0 ? "var(--red)" : "var(--ink)" }}>{money(totals.totalHeadroom)}</td>
                <td className="fos-num" style={{ ...td, textAlign: "right", borderBottom: "none", borderTop: "1px solid var(--line)" }} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {(totals.overLimit || totals.nearLimit) ? (
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
          {totals.overLimit ? <span style={{ color: "var(--red)" }}>{totals.overLimit} over limit</span> : null}
          {totals.overLimit && totals.nearLimit ? " · " : null}
          {totals.nearLimit ? <span style={{ color: "var(--amber)" }}>{totals.nearLimit} near limit (≥90%)</span> : null}
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------------- Manage suppliers ---------------- */
function ManageSuppliers({ suppliers, post, busy }) {
  const [showNew, setShowNew] = useState(false);
  const [np, setNp] = useState(EMPTY_NEW);

  function addSupplier() {
    if (!np.name.trim()) return;
    post({
      op: "upsert", name: np.name.trim(), source_type: np.source_type || null,
      credit_limit: np.credit_limit === "" ? null : Number(np.credit_limit),
      payment_days: np.payment_days === "" ? null : Number(np.payment_days),
      active: np.active, active_merch: np.active_merch,
    }, { note: `Supplier “${np.name.trim()}” saved.` }).then((j) => { if (j) { setNp(EMPTY_NEW); setShowNew(false); } });
  }

  return (
    <Panel title="Manage suppliers" note="edit a supplier inline, or add a new one">
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showNew ? 12 : 0, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 650 }}>Add supplier</div>
          <button style={ghost} onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "Add supplier"}</button>
        </div>
        {showNew && (
          <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, alignItems: "end" }}>
              <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Name *</span><input style={inputSt} value={np.name} onChange={(e) => setNp((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. MINISO HQ (Guangzhou)" /></label>
              <label style={field}><span style={labelSt}>Source</span>
                <select style={inputSt} value={np.source_type} onChange={(e) => setNp((s) => ({ ...s, source_type: e.target.value }))}>
                  <option value="">—</option>
                  {SUPPLIER_SOURCE_TYPES.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </label>
              <label style={field}><span style={labelSt}>Payment days</span><input type="number" min="0" style={{ ...inputSt, textAlign: "right" }} className="fos-num" value={np.payment_days} onChange={(e) => setNp((s) => ({ ...s, payment_days: e.target.value }))} placeholder="e.g. 30" /></label>
              <label style={field}><span style={labelSt}>Credit limit (£)</span><MoneyInput style={inputSt} value={np.credit_limit} onChange={(e) => setNp((s) => ({ ...s, credit_limit: e.target.value }))} placeholder="blank = none" /></label>
              <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={np.active} onChange={(e) => setNp((s) => ({ ...s, active: e.target.checked }))} />
                <span style={labelSt}>Active</span>
              </label>
              <label style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={np.active_merch} onChange={(e) => setNp((s) => ({ ...s, active_merch: e.target.checked }))} />
                <span style={labelSt}>Active to Merch</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button style={btn("var(--accent)")} disabled={busy || !np.name.trim()} onClick={addSupplier}>{busy ? "Working…" : "Create supplier"}</button>
              <button style={ghost} onClick={() => { setShowNew(false); setNp(EMPTY_NEW); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Suppliers <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {suppliers.length}</span></div>
        {!suppliers.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No suppliers yet. Add one above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
              <thead><tr>
                <th style={th}>Name</th>
                <th style={th}>Source</th>
                <th style={{ ...th, textAlign: "right" }}>Payment days</th>
                <th style={{ ...th, textAlign: "right" }}>Credit limit (£)</th>
                <th style={{ ...th, textAlign: "center" }}>Active</th>
                <th style={{ ...th, textAlign: "center" }}>Active to Merch</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr></thead>
              <tbody>
                {suppliers.map((s) => <SupplierRow key={s.id} s={s} post={post} busy={busy} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SupplierRow({ s, post, busy }) {
  const [name, setName] = useState(s.name || "");
  const [sourceType, setSourceType] = useState(s.source_type || "");
  const [paymentDays, setPaymentDays] = useState(s.payment_days == null ? "" : String(s.payment_days));
  const [creditLimit, setCreditLimit] = useState(s.credit_limit == null ? "" : String(s.credit_limit));
  const [active, setActive] = useState(s.active !== false);
  const [activeMerch, setActiveMerch] = useState(s.active_merch !== false);

  const dirty = name !== (s.name || "") || sourceType !== (s.source_type || "")
    || paymentDays !== (s.payment_days == null ? "" : String(s.payment_days))
    || creditLimit !== (s.credit_limit == null ? "" : String(s.credit_limit))
    || active !== (s.active !== false) || activeMerch !== (s.active_merch !== false);

  function save() {
    if (!name.trim()) return;
    post({
      op: "upsert", id: s.id, name: name.trim(), source_type: sourceType || null,
      payment_days: paymentDays === "" ? null : Number(paymentDays),
      credit_limit: creditLimit === "" ? null : Number(creditLimit), active, active_merch: activeMerch,
    }, { note: `Supplier “${name.trim()}” saved.` });
  }

  return (
    <tr>
      <td style={{ ...td, minWidth: 200 }}><input style={{ ...inputSt, width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td style={td}>
        <select style={{ ...inputSt, width: 140 }} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          <option value="">—</option>
          {SUPPLIER_SOURCE_TYPES.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </td>
      <td style={{ ...td, textAlign: "right" }}><input type="number" min="0" style={{ ...inputSt, width: 90, textAlign: "right" }} className="fos-num" value={paymentDays} onChange={(e) => setPaymentDays(e.target.value)} placeholder="—" /></td>
      <td style={{ ...td, textAlign: "right" }}><MoneyInput style={{ ...inputSt, width: 130, textAlign: "right" }} className="fos-num" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="none" /></td>
      <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></td>
      <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={activeMerch} onChange={(e) => setActiveMerch(e.target.checked)} /></td>
      <td style={{ ...td, textAlign: "right" }}>
        <button style={{ ...btn("var(--accent)"), padding: "6px 12px", opacity: dirty ? 1 : 0.5 }} disabled={busy || !dirty || !name.trim()} onClick={save}>Save</button>
      </td>
    </tr>
  );
}
