"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PO_CATEGORIES, CURRENCIES, rechargeTotal, rechargeError, equalSplit,
  invoiceOutcome, canSubmitForSignoff,
} from "../../../lib/po-rules";

const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const money = (v, c = "GBP") => (v == null || v === "" ? "—" : `${c === "GBP" ? "£" : c + " "}${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const STATUS_TONE = { DRAFT: "var(--muted)", PENDING_SIGNOFF: "var(--amber)", APPROVED: "var(--green)", REJECTED: "var(--red)", CANCELLED: "var(--faint)" };

const EMPTY = {
  po_date: "", supplier: "", payment_terms: "", payment_date: "", currency: "GBP",
  payment_value: "", vat_amount: "", po_category: "", xero_po_number: "",
  fulfilment_date: "", fulfilment_period: "", department: "", notes: "",
  is_marketing: false, marketing_levy: null, recharge_enabled: false,
};

export default function PoUI({ initialPos, departments, stores, me }) {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [recharge, setRecharge] = useState([]); // [{store_code, store_name, pct}]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rowErr, setRowErr] = useState({}); // per-PO submit errors

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setChk = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));

  const total = rechargeTotal(recharge);
  const rErr = f.recharge_enabled ? rechargeError(recharge) : null;
  const outcome = invoiceOutcome({ isMarketing: f.is_marketing, marketingLevy: f.marketing_levy, rechargeEnabled: f.recharge_enabled });

  const selected = useMemo(() => new Set(recharge.map((r) => r.store_code)), [recharge]);

  function toggleStore(s, on) {
    setRecharge((cur) => on
      ? [...cur, { store_code: s.store_code, store_name: s.store_name, pct: 0 }]
      : cur.filter((r) => r.store_code !== s.store_code));
  }
  function toggleAll(on) {
    setRecharge(on ? stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name, pct: 0 })) : []);
  }
  function setPct(code, v) {
    setRecharge((cur) => cur.map((r) => (r.store_code === code ? { ...r, pct: v === "" ? "" : Number(v) } : r)));
  }
  function doEqualSplit() {
    setRecharge((cur) => equalSplit(cur));
  }

  const gate = canSubmitForSignoff(
    { ...f, payment_value: f.payment_value === "" ? 0 : f.payment_value },
    recharge
  );

  async function create(submitAfter) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const body = { ...f, recharge: f.recharge_enabled ? recharge : [] };
      const res = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not create P.O");
      if (submitAfter) {
        const r2 = await fetch(`/api/purchase-orders/${j.poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "submit" }) });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error || "Created, but could not submit for sign-off");
      }
      setMsg(submitAfter ? "P.O created and submitted for department-head sign-off." : "P.O saved as draft.");
      setF(EMPTY); setRecharge([]);
      router.refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function poOp(poId, op) {
    setRowErr((s) => ({ ...s, [poId]: null }));
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed");
      router.refresh();
    } catch (e) { setRowErr((s) => ({ ...s, [poId]: e.message })); }
  }

  return (
    <div>
      {/* ---- New P.O ---- */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Raise a purchase order</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 16 }}>Generate the P.O number in Xero first, then record it here. All fields marked are required.</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          <label style={field}><span style={labelSt}>Date *</span><input type="date" style={inputSt} value={f.po_date} onChange={set("po_date")} /></label>
          <label style={field}><span style={labelSt}>Supplier *</span><input style={inputSt} value={f.supplier} onChange={set("supplier")} /></label>
          <label style={field}><span style={labelSt}>Payment terms</span><input style={inputSt} placeholder="e.g. 30 days" value={f.payment_terms} onChange={set("payment_terms")} /></label>
          <label style={field}><span style={labelSt}>Payment date</span><input type="date" style={inputSt} value={f.payment_date} onChange={set("payment_date")} /></label>
          <label style={field}><span style={labelSt}>Currency *</span><select style={inputSt} value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={field}><span style={labelSt}>Payment value *</span><input type="number" min="0" step="0.01" style={inputSt} value={f.payment_value} onChange={set("payment_value")} /></label>
          <label style={field}><span style={labelSt}>VAT amount</span><input type="number" min="0" step="0.01" style={inputSt} value={f.vat_amount} onChange={set("vat_amount")} /></label>
          <label style={field}><span style={labelSt}>P.O category *</span><select style={inputSt} value={f.po_category} onChange={set("po_category")}><option value="">—</option>{PO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={field}><span style={labelSt}>Xero P.O number *</span><input style={inputSt} placeholder="e.g. PO-1042" value={f.xero_po_number} onChange={set("xero_po_number")} /></label>
          <label style={field}><span style={labelSt}>Fulfilment date</span><input type="date" style={inputSt} value={f.fulfilment_date} onChange={set("fulfilment_date")} /></label>
          <label style={field}><span style={labelSt}>Fulfilment period</span><input style={inputSt} placeholder="e.g. 2026-08" value={f.fulfilment_period} onChange={set("fulfilment_period")} /></label>
          <label style={field}><span style={labelSt}>Department *</span>
            <input list="po-departments" style={inputSt} value={f.department} onChange={set("department")} placeholder="Choose or type" />
            <datalist id="po-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
        </div>

        {/* Marketing → levy */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={f.is_marketing} onChange={(e) => setF((s) => ({ ...s, is_marketing: e.target.checked, marketing_levy: e.target.checked ? s.marketing_levy : null }))} />
            This is marketing spend
          </label>
          {f.is_marketing && (
            <div style={{ marginTop: 10, marginLeft: 4 }}>
              <div style={{ ...labelSt, marginBottom: 6 }}>Is it part of the marketing levy? *</div>
              <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                <label style={{ display: "inline-flex", gap: 6 }}><input type="radio" name="levy" checked={f.marketing_levy === true} onChange={() => setF((s) => ({ ...s, marketing_levy: true, recharge_enabled: true }))} /> Yes — allocate to stores, no invoice</label>
                <label style={{ display: "inline-flex", gap: 6 }}><input type="radio" name="levy" checked={f.marketing_levy === false} onChange={() => setF((s) => ({ ...s, marketing_levy: false }))} /> No — finance to issue an invoice</label>
              </div>
            </div>
          )}
        </div>

        {/* Recharge */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" checked={f.recharge_enabled} onChange={setChk("recharge_enabled")} />
            Recharge this P.O to stores
          </label>
          {f.recharge_enabled && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <label style={{ display: "inline-flex", gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={stores.length > 0 && selected.size === stores.length} onChange={(e) => toggleAll(e.target.checked)} />
                  All stores ({stores.length})
                </label>
                <button type="button" style={ghost} disabled={!recharge.length} onClick={doEqualSplit}>Equal split across selected</button>
                <span style={{ fontSize: 12.5, marginLeft: "auto", color: Math.abs(total - 100) < 0.01 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                  Total: {total}%
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 6, maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                {stores.map((s) => {
                  const on = selected.has(s.store_code);
                  const line = recharge.find((r) => r.store_code === s.store_code);
                  return (
                    <div key={s.store_code || s.store_name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={on} onChange={(e) => toggleStore(s, e.target.checked)} />
                      <span style={{ flex: 1, fontSize: 12.5, color: on ? "var(--ink)" : "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.store_name}</span>
                      {on && <input type="number" min="0" step="0.01" value={line?.pct ?? ""} onChange={(e) => setPct(s.store_code, e.target.value)} style={{ ...inputSt, width: 72, padding: "4px 6px", textAlign: "right" }} />}
                      {on && <span style={{ fontSize: 11, color: "var(--faint)" }}>%</span>}
                    </div>
                  );
                })}
              </div>
              {rErr && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>⚠ {rErr}</div>}
              <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>{outcome.label}. Percentages must total 100% before this P.O can go to sign-off.</div>
            </div>
          )}
        </div>

        <label style={{ ...field, marginTop: 16 }}><span style={labelSt}>Notes</span><textarea rows={2} style={inputSt} value={f.notes} onChange={set("notes")} /></label>

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</div>}
        {msg && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 12 }}>{msg}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          <button style={ghost} disabled={busy} onClick={() => create(false)}>Save draft</button>
          <button style={btn("var(--accent)")} disabled={busy || !!gate} title={gate || "Submit for department-head sign-off"} onClick={() => create(true)}>
            {busy ? "Working…" : "Create & submit for sign-off"}
          </button>
          {gate && <span style={{ fontSize: 12, color: "var(--faint)" }}>{gate}</span>}
        </div>
      </div>

      {/* ---- Existing P.O.s ---- */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>Purchase orders</div>
        {!initialPos.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No purchase orders yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
              <thead><tr>{["Xero P.O", "Supplier", "Dept", "Category", "Value", "Recharge", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {initialPos.map((p) => (
                  <tr key={p.po_id}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.xero_po_number}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.supplier}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.department}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.po_category}{p.is_marketing ? (p.marketing_levy ? " · levy" : " · invoice") : ""}</td>
                    <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>{money(p.payment_value, p.currency)}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.recharge_enabled ? "Yes" : "—"}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", color: STATUS_TONE[p.status], fontWeight: 600 }}>{p.status.replace(/_/g, " ")}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                      {(p.status === "DRAFT" || p.status === "REJECTED") && <button style={ghost} onClick={() => poOp(p.po_id, "submit")}>Submit for sign-off</button>}
                      {p.status === "PENDING_SIGNOFF" && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting department-head sign-off <button style={{ ...ghost, marginLeft: 6 }} onClick={() => poOp(p.po_id, "return")}>Return to draft</button></span>}
                      {rowErr[p.po_id] && <div style={{ color: "var(--red)", fontSize: 11.5, marginTop: 4 }}>{rowErr[p.po_id]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12 }}>
          Department-head sign-off is enforced by user controls (coming soon); for now a P.O rests at “awaiting sign-off”.
        </div>
      </div>
    </div>
  );
}
