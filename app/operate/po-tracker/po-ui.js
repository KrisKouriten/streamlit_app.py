"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PO_CATEGORIES, CURRENCIES, rechargeTotal, rechargeError, equalSplit,
  invoiceOutcome, canSubmitForSignoff, displayStatus, canDeletePo, canEditPo, isChallenged, challengeReasonLabels,
  CHALLENGE_RETURN_ROUTES, termDaysFrom, dueDateFrom, MARKETING_BUDGET_LINKS, poRef,
} from "../../../lib/po-rules";
import DateField from "../../finance-os/date-field";
import MoneyInput from "../../money-input";
import SupplierPicker from "../supplier-picker";

const gbp = (v) => `£${Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
// The submitter, stored as an email or name — show a readable form.
const submitterName = (v) => (v ? String(v).split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

// The "Self-approval status" panel shown before submitting — POs used, cumulative
// value vs the cap, this P.O, and the routing outcome with the binding reason.
function SelfApprovalStatus({ d, value }) {
  const ok = d.selfApprove;
  const line = (a, b) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: "var(--muted)" }}>{a}</span><span className="fos-num" style={{ color: "var(--ink)" }}>{b}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 16, borderRadius: 10, padding: "12px 14px",
      border: `1px solid ${ok ? "var(--green)" : "var(--amber)"}`,
      background: ok ? "var(--green-bg)" : "var(--amber-bg)" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: ok ? "var(--green)" : "var(--amber)", marginBottom: 8 }}>Self-approval status</div>
      {d.countLimit != null && line("P.Os used", `${d.usedCount} of ${d.countLimit}${d.remainingCount != null ? ` · ${d.remainingCount} remaining` : ""}`)}
      {d.maxCumulative != null && line("Cumulative value", `${gbp(d.usedValue)} of ${gbp(d.maxCumulative)}`)}
      {line("This P.O", gbp(value))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--hairline)", fontSize: 12.5, fontWeight: 600, color: ok ? "var(--green)" : "var(--amber)" }}>
        {ok ? "Within self-approval — this signs off automatically and goes straight to Finance." : (d.binding || "Department sign-off required.")}
      </div>
    </div>
  );
}

const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const money = (v, c = "GBP") => (v == null || v === "" ? "—" : `${c === "GBP" ? "£" : c + " "}${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const TONE_FG = { muted: "var(--muted)", red: "var(--red)", amber: "var(--amber)", green: "var(--green)", accent: "var(--accent)" };
const TONE_BG = { muted: "var(--raise)", red: "var(--red-bg)", amber: "var(--amber-bg)", green: "var(--green-bg)", accent: "var(--accent-bg)" };

function StatusPill({ po }) {
  const st = displayStatus(po);
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: TONE_FG[st.tone], background: TONE_BG[st.tone], border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", lineHeight: 1.2 }}>
      {st.label}
    </span>
  );
}

const EMPTY = {
  po_date: "", supplier: "", payment_terms: "", payment_date: "", currency: "GBP",
  payment_value: "", po_category: "",
  fulfilment_start_date: "", fulfilment_days: "", department: "", notes: "",
  is_marketing: false, marketing_levy: null, recharge_enabled: false, recharge_ho_only: false,
  marketing_budget_category: "", marketing_campaign: "", business_project_id: "",
};

export default function PoUI({ initialPos, departments, stores, me, isAdmin = false, approverDepts = [], marketingCampaigns = [], businessProjects = [], selfApproveLimit = 0, supplierNames = [] }) {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [recharge, setRecharge] = useState([]); // [{store_code, store_name, pct}]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rowErr, setRowErr] = useState({}); // per-PO submit errors
  const [dueTouched, setDueTouched] = useState(false); // has the user hand-set the due date?
  const [editing, setEditing] = useState(null);        // { poId, po } when editing an existing P.O
  const editingChallenged = !!editing && isChallenged(editing.po);
  const returnRouteLabel = (code) => (CHALLENGE_RETURN_ROUTES.find((r) => r.code === code) || {}).label || null;

  const approverSet = useMemo(() => new Set((approverDepts || []).map((d) => (d || "").toLowerCase())), [approverDepts]);
  const canApprove = (po) => isAdmin || approverSet.has((po.department || "").toLowerCase());

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setDate = (k) => (iso) => setF((s) => ({ ...s, [k]: iso }));
  const setChk = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));

  // Due date = P.O date + payment-term days, unless the user has set it by hand.
  useEffect(() => {
    if (dueTouched) return;
    const days = termDaysFrom(f.payment_terms);
    const due = dueDateFrom(f.po_date, days);
    if (due && due !== f.payment_date) setF((s) => ({ ...s, payment_date: due }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.po_date, f.payment_terms, dueTouched]);

  const isMarketingDept = (f.department || "").toLowerCase() === "marketing";

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

  // Live "Self-approval status": the server resolves the department policy
  // (count / individual / cumulative limits) against the current period usage,
  // so the requester sees up front whether the P.O self-approves or routes to
  // sign-off, and why. Debounced on department + value.
  const [decision, setDecision] = useState(null);
  const previewValue = f.payment_value === "" ? 0 : Number(f.payment_value);
  useEffect(() => {
    if (!f.department || !(previewValue > 0)) { setDecision(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/purchase-orders/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ department: f.department, value: previewValue }),
        });
        const j = await res.json().catch(() => ({}));
        if (live && res.ok) setDecision(j.decision);
      } catch { /* preview is best-effort */ }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [f.department, previewValue]);
  const willSelfApprove = !!decision?.selfApprove;

  async function create(submitAfter) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const body = { ...f, recharge: f.recharge_enabled ? recharge : [] };
      const res = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not create P.O");
      let selfApproved = false;
      if (submitAfter) {
        const r2 = await fetch(`/api/purchase-orders/${j.poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "submit" }) });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error || "Created, but could not submit for sign-off");
        selfApproved = !!j2.selfApproved;
      }
      const ref = j.poNumber ? ` (${j.poNumber})` : "";
      setMsg(!submitAfter
        ? `P.O${ref} saved as draft.`
        : selfApproved
          ? `P.O${ref} created and signed off automatically (within the self-approval limit) — it's now with Finance.`
          : `P.O${ref} created and submitted for department-head sign-off.`);
      setF(EMPTY); setRecharge([]); setDueTouched(false);
      router.refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // Load an existing P.O into the form for editing (drafts, rejected, or a P.O
  // Finance has challenged). Hydrates the header + recharge allocation.
  async function beginEdit(p) {
    setError(null); setMsg(null);
    try {
      const res = await fetch(`/api/purchase-orders/${p.po_id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load the P.O");
      const po = j.po || p;
      const iso = (v) => (v ? String(v).slice(0, 10) : "");
      setF({
        po_date: iso(po.po_date), supplier: po.supplier || "", payment_terms: po.payment_terms || "",
        payment_date: iso(po.payment_date), currency: po.currency || "GBP",
        payment_value: po.payment_value != null ? String(po.payment_value) : "",
        po_category: po.po_category || "",
        fulfilment_start_date: iso(po.fulfilment_start_date), fulfilment_days: po.fulfilment_days != null ? String(po.fulfilment_days) : "",
        department: po.department || "", notes: po.notes || "",
        is_marketing: !!po.is_marketing, marketing_levy: po.is_marketing ? (po.marketing_levy ?? null) : null,
        recharge_enabled: !!po.recharge_enabled, recharge_ho_only: !!po.recharge_ho_only,
        marketing_budget_category: po.marketing_budget_category || "", marketing_campaign: po.marketing_campaign || "",
        business_project_id: po.business_project_id != null ? String(po.business_project_id) : "",
      });
      setRecharge(po.recharge_ho_only ? [] : (j.recharge || []).map((r) => ({ store_code: r.store_code, store_name: r.store_name, pct: Number(r.pct) })));
      setDueTouched(true);
      setEditing({ poId: p.po_id, po });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setRowErr((s) => ({ ...s, [p.po_id]: e.message })); }
  }

  function cancelEdit() {
    setEditing(null); setF(EMPTY); setRecharge([]); setDueTouched(false); setError(null); setMsg(null);
  }

  // Save edits to an existing P.O, then (optionally) put it back into the flow —
  // "submit" for a draft/rejected P.O, "resubmit-challenge" for a challenged one.
  async function saveEdit(sendOn) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const patch = {
        po_date: f.po_date || null, supplier: f.supplier, payment_terms: f.payment_terms || null,
        payment_date: f.payment_date || null, currency: f.currency,
        payment_value: f.payment_value === "" ? 0 : Number(f.payment_value),
        po_category: f.po_category, fulfilment_start_date: f.fulfilment_start_date || null,
        fulfilment_days: f.fulfilment_days === "" ? null : Number(f.fulfilment_days),
        department: f.department, notes: f.notes || null,
        is_marketing: !!f.is_marketing, marketing_levy: f.is_marketing ? f.marketing_levy : null,
        recharge_enabled: !!f.recharge_enabled, recharge_ho_only: !!f.recharge_ho_only,
        recharge: f.recharge_enabled && !f.recharge_ho_only ? recharge : [],
        marketing_budget_category: f.marketing_budget_category || null, marketing_campaign: f.marketing_campaign || null,
        business_project_id: f.business_project_id || null,
      };
      const res = await fetch(`/api/purchase-orders/${editing.poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "update", patch }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not save changes");
      if (sendOn) {
        const op = editingChallenged ? "resubmit-challenge" : "submit";
        const r2 = await fetch(`/api/purchase-orders/${editing.poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op }) });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error || "Saved, but could not resubmit");
        setMsg(editingChallenged
          ? (j2.route === "TO_SIGNOFF" ? "Saved and sent back for department sign-off." : "Saved and sent back to Finance.")
          : "Saved and submitted for sign-off.");
      } else {
        setMsg("Changes saved.");
      }
      setEditing(null); setF(EMPTY); setRecharge([]); setDueTouched(false);
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

  function deletePo(p) {
    if (!window.confirm(`Delete P.O ${p.xero_po_number || p.po_id}? This removes the request and its store allocations. This cannot be undone.`)) return;
    poOp(p.po_id, "delete");
  }

  return (
    <div>
      {/* ---- New / Edit P.O ---- */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>{editing ? `Edit ${poRef(editing.po)}` : "Raise a purchase order"}</div>
          {editing && <button style={ghost} onClick={cancelEdit}>Cancel edit</button>}
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 16 }}>
          {editing ? "Make your changes below, then save — or save and send it on." : "A unique P.O number is generated automatically when you save — no need to raise it in Xero first. All fields marked are required."}
        </div>
        {editingChallenged && (
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "var(--red-bg)", border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--red)" }}>Finance challenged this P.O — {challengeReasonLabels(editing.po.challenge_reasons).join(" · ")}</div>
            {editing.po.challenge_note && <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 4 }}>{editing.po.challenge_note}</div>}
            {returnRouteLabel(editing.po.challenge_return_route) && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>On resubmit: {returnRouteLabel(editing.po.challenge_return_route)}</div>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
          <label style={field}><span style={labelSt}>Date *</span><DateField value={f.po_date} onChange={setDate("po_date")} /></label>
          <label style={field}><span style={labelSt}>Supplier *</span>
            <SupplierPicker options={supplierNames} value={f.supplier} onChange={(name) => setF((s) => ({ ...s, supplier: name }))} selectStyle={inputSt} required />
          </label>
          <label style={field}><span style={labelSt}>Payment terms</span><input style={inputSt} placeholder="e.g. 30 days" value={f.payment_terms} onChange={set("payment_terms")} /></label>
          <label style={field}><span style={labelSt}>Due date</span><DateField value={f.payment_date} onChange={(iso) => { setDueTouched(true); setDate("payment_date")(iso); }} />
            <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{dueTouched ? "set manually" : "auto: P.O date + payment terms"}</span>
          </label>
          <label style={field}><span style={labelSt}>Currency *</span><select style={inputSt} value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={field}><span style={labelSt}>Net value (£) *</span><MoneyInput style={inputSt} value={f.payment_value} onChange={set("payment_value")} /></label>
          <label style={field}><span style={labelSt}>P.O category *</span><select style={inputSt} value={f.po_category} onChange={set("po_category")}><option value="">—</option>{PO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={field}><span style={labelSt}>Fulfilment start date</span><DateField value={f.fulfilment_start_date} onChange={setDate("fulfilment_start_date")} /></label>
          <label style={field}><span style={labelSt}>Fulfilment period (days)</span><input type="number" min="0" step="1" style={inputSt} placeholder="e.g. 30" value={f.fulfilment_days} onChange={set("fulfilment_days")} /></label>
          <label style={field}><span style={labelSt}>Department *</span>
            <select style={inputSt} value={f.department} onChange={set("department")}>
              <option value="">— choose —</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label style={field}><span style={labelSt}>Business project</span>
            <select style={inputSt} value={f.business_project_id} onChange={set("business_project_id")}>
              <option value="">— none —</option>
              {businessProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status && p.status !== "Active" ? ` (${p.status})` : ""}</option>)}
            </select>
            <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{businessProjects.length ? "Allocate this spend to a business project (Plan — HO)." : "No business projects set up yet."}</span>
          </label>
        </div>

        {/* Marketing budget link — only when the department is Marketing */}
        {isMarketingDept && (
          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 3 }}>Marketing budget link</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12 }}>Tie this P.O to the Marketing budget so spend reports against plan on the Marketing dashboard.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
              <label style={field}><span style={labelSt}>Budget area</span>
                <select style={inputSt} value={f.marketing_budget_category} onChange={set("marketing_budget_category")}>
                  <option value="">— choose —</option>
                  {MARKETING_BUDGET_LINKS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={field}><span style={labelSt}>Campaign / initiative</span>
                <input style={inputSt} list="mk-campaigns" placeholder="e.g. Star Wars, Toy Story 5" value={f.marketing_campaign} onChange={set("marketing_campaign")} />
                <datalist id="mk-campaigns">
                  {marketingCampaigns.map((c) => <option key={c} value={c} />)}
                </datalist>
                <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{marketingCampaigns.length ? "Pick a live campaign from the Marketing budget, or type a new one." : "Type the campaign name (no budget campaigns set up yet)."}</span>
              </label>
            </div>
          </div>
        )}

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
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 12 }}>
                <input type="checkbox" checked={f.recharge_ho_only} onChange={(e) => setF((s) => ({ ...s, recharge_ho_only: e.target.checked }))} />
                Head Office only — allocate 100% to Head Office (no store split)
              </label>
              {f.recharge_ho_only ? (
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>The full P.O value is recharged to <strong>Head Office</strong>. {outcome.label}.</div>
              ) : (
              <>
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
              </>
              )}
            </div>
          )}
        </div>

        <label style={{ ...field, marginTop: 16 }}><span style={labelSt}>Notes</span><textarea rows={2} style={inputSt} value={f.notes} onChange={set("notes")} /></label>

        {decision && !gate && <SelfApprovalStatus d={decision} value={previewValue} />}

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</div>}
        {msg && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 12 }}>{msg}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
          {editing ? (
            <>
              <button style={ghost} disabled={busy} onClick={() => saveEdit(false)}>Save changes</button>
              <button style={btn("var(--accent)")} disabled={busy || !!gate} title={gate || "Save and send it on"} onClick={() => saveEdit(true)}>
                {busy ? "Working…" : editingChallenged ? "Save & resubmit" : "Save & submit for sign-off"}
              </button>
            </>
          ) : (
            <>
              <button style={ghost} disabled={busy} onClick={() => create(false)}>Save draft</button>
              <button style={btn("var(--accent)")} disabled={busy || !!gate} title={gate || (willSelfApprove ? "Within self-approval — signs off automatically" : "Submit for department-head sign-off")} onClick={() => create(true)}>
                {busy ? "Working…" : willSelfApprove ? "Create & sign off" : "Create & submit for sign-off"}
              </button>
            </>
          )}
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
              <thead><tr>{["P.O number", "Supplier", "Submitted by", "Dept", "Category", "Value", "Recharge", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {initialPos.map((p) => {
                  const del = canDeletePo(p, { isAdmin });
                  const challengeLabels = p.finance_status === "CHALLENGED" ? challengeReasonLabels(p.challenge_reasons) : [];
                  return (
                  <tr key={p.po_id}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{poRef(p)}{p.self_approved ? <span title="Self-approved (within the self-approval limit)" style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>· self</span> : null}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.supplier}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)", whiteSpace: "nowrap" }}>{submitterName(p.created_by)}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.department}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.po_category}{p.is_marketing ? (p.marketing_levy ? " · levy" : " · invoice") : ""}</td>
                    <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>{money(p.payment_value, p.currency)}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>{p.recharge_enabled ? "Yes" : "—"}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)" }}>
                      <StatusPill po={p} />
                      {challengeLabels.length > 0 && (
                        <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 200, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeLabels.join(" · ")}</div>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {canEditPo(p) && editing?.poId !== p.po_id && (
                          <button style={isChallenged(p) ? btn("var(--red)") : ghost} onClick={() => beginEdit(p)}>{isChallenged(p) ? "Edit & resubmit" : "Edit"}</button>
                        )}
                        {(p.status === "DRAFT" || p.status === "REJECTED") && <button style={ghost} onClick={() => poOp(p.po_id, "submit")}>Submit for sign-off</button>}
                        {p.status === "PENDING_SIGNOFF" && canApprove(p) && (
                          <>
                            <button style={btn("var(--green)")} onClick={() => poOp(p.po_id, "approve")}>Approve</button>
                            <button style={ghost} onClick={() => poOp(p.po_id, "reject")}>Reject</button>
                          </>
                        )}
                        {p.status === "PENDING_SIGNOFF" && !canApprove(p) && (
                          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting department-head sign-off
                            <button style={{ ...ghost, marginLeft: 6 }} onClick={() => poOp(p.po_id, "return")}>Return to draft</button>
                          </span>
                        )}
                        {p.status === "APPROVED" && p.finance_status !== "CLOSED" && p.finance_status !== "CHALLENGED" && (
                          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>With Finance</span>
                        )}
                        {del.ok
                          ? <button style={{ ...ghost, color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} onClick={() => deletePo(p)}>Delete</button>
                          : <span title={del.reason} style={{ fontSize: 11, color: "var(--faint)" }}>🔒 admin-only delete</span>}
                      </div>
                      {rowErr[p.po_id] && <div style={{ color: "var(--red)", fontSize: 11.5, marginTop: 4 }}>{rowErr[p.po_id]}</div>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.6 }}>
          A department&rsquo;s sign-off approvers (or an admin) approve or reject a P.O awaiting sign-off. Once signed off, a P.O can only be deleted by an admin, and Finance takes it forward on <a href="/operate/po-summary" style={{ color: "var(--accent)" }}>P.O Summary + Close</a> — recording the invoice and closing it (→ committed spend) or raising a challenge, which shows here in red. When a P.O is challenged, use <strong>Edit &amp; resubmit</strong> to fix it and send it back (to Finance or for a fresh sign-off, whichever Finance chose).
        </div>
      </div>
    </div>
  );
}
