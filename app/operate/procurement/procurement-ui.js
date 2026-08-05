"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, Badge, IllustrativeBanner } from "../../finance-os/ui";
import { cashOutFor, PROC_STATUS_META } from "../../../lib/procurement-rules";

/* Procurement Request UI: three sections. Miniso / Local are the cash-tracker
   purchases (monthly cash budget vs committed spend, bucketed by supplier payment
   terms). Merchandising requests raise an OTB-validated channel request (moved
   here from the OTB workspace) against the approved Open-to-Buy. */

const SECTIONS = [["MINISO", "Miniso purchases"], ["LOCAL", "Local purchases"], ["MERCH", "Merchandising requests"]];
const VAL_TONE = { WITHIN_OTB: "green", OTB_WARNING: "amber", EXCEEDS_OTB: "red", NO_APPROVED_OTB: "muted", APPROVED_EXCEPTION: "accent" };
const REQ_ACTIONS = {
  DRAFT: [["submit", "Submit"]],
  MERCH_REVIEW: [["validate", "Validate"], ["reject", "Reject"]],
  OTB_VALIDATED: [["finance", "To finance"], ["reject", "Reject"]],
  FINANCE_REVIEW: [["approve", "Approve"], ["reject", "Reject"]],
  APPROVED: [["order", "Mark ordered"]],
};
const CSV_TEMPLATE = "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference\nMiniso,MINISO HQ,Core range,2026-07,420000,60,Committed,PO-1\nLocal,Design360,Fixtures,2026-07,42000,30,Committed,PO-2\n";
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };

async function post(body) {
  const res = await fetch("/api/procurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function ProcurementUI({ data, ready, loaded, illustrative, canManage, orders = [], roles = {}, otbVersions = [], activeVersionId = null, merchRequests = [], channelOpts = [] }) {
  const router = useRouter();
  const [tab, setTab] = useState("MINISO");
  const [err, setErr] = useState("");

  if (!ready) {
    return <div className="fos-card" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
      <div style={{ fontSize: 15, fontWeight: 650, color: "var(--ink)", marginBottom: 6 }}>One migration to run</div>
      This module needs migration <span style={{ fontFamily: "var(--mono)" }}>016_procurement.sql</span> (idempotent). Run it, refresh, then upload purchases.
    </div>;
  }

  const isMerch = tab === "MERCH";
  const s = data[tab];

  async function saveBudget(ym, value) {
    setErr("");
    try { await post({ action: "budget", source: tab, ym, budget: Number(value) }); router.refresh(); }
    catch (x) { setErr(x.message); }
  }

  return (
    <>
      {illustrative && !isMerch && <IllustrativeBanner>These purchases are illustrative — upload the merch team's PO/purchase extract (with supplier payment terms) and the real cash-budget control replaces them.</IllustrativeBanner>}

      <div style={{ display: "inline-flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
        {SECTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize: 12.5, fontWeight: tab === key ? 600 : 500, padding: "6px 14px", borderRadius: 7, border: `1px solid ${tab === key ? "var(--line-strong)" : "transparent"}`,
            background: tab === key ? "var(--surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-1)" : "none", color: tab === key ? "var(--ink)" : "var(--muted)",
          }}>{label}</button>
        ))}
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{err}</div>}

      {isMerch ? (
        <MerchRequests otbVersions={otbVersions} activeVersionId={activeVersionId} requests={merchRequests} channelOpts={channelOpts} canManage={canManage} />
      ) : (
      <>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
        <Tile label="Committed spend" value={money(s.totalCommitted, { compact: true })} sub="all months" />
        <Tile label="Cash budget" value={money(s.totalBudget, { compact: true })} sub="sum of monthly budgets" />
        <Tile label="Over-budget months" value={s.months.filter((m) => m.overBudget).length} tone={s.months.some((m) => m.overBudget) ? "var(--red)" : "var(--green)"} sub="cash-out basis" />
        <Tile label="Suppliers" value={s.suppliers.length} sub="with orders" />
      </div>

      <Panel title="Monthly cash budget vs committed" note="committed spend lands in the month it falls due (order month-end + supplier terms)">
        {s.months.length === 0 ? <Empty>No purchases or budgets for this section yet.</Empty> : (
          <Table head={["Cash-out month", "Committed", "Budget", "Variance", "", "Status"]} align={[0, 1, 1, 1, 1, 0]}>
            {s.months.map((m) => (
              <tr key={m.ym}>
                <Td>{monthLabel(m.ym)}</Td>
                <Td r>{money(m.committed)}</Td>
                <Td r>{canManage ? (
                  <input defaultValue={m.budget ?? ""} placeholder="—" onBlur={(e) => { if (e.target.value !== String(m.budget ?? "")) saveBudget(m.ym, e.target.value || 0); }}
                    style={{ width: 100, textAlign: "right", height: 26, fontSize: 12.5, padding: "0 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" }} className="fos-num" />
                ) : (m.budget == null ? "—" : money(m.budget))}</Td>
                <Td r tone={m.variance == null ? undefined : m.variance < 0 ? "var(--red)" : "var(--green)"}>{m.variance == null ? "—" : money(m.variance)}</Td>
                <Td r>{m.budget ? <Bar value={m.committed} max={m.budget} over={m.overBudget} /> : null}</Td>
                <Td>{m.budget == null ? <span style={{ color: "var(--faint)" }}>no budget</span> : <Badge tone={m.overBudget ? "red" : "green"}>{m.overBudget ? "Over" : "Within"}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Suppliers" note="payment terms drive the cash-out month">
        {s.suppliers.length === 0 ? <Empty>No suppliers yet.</Empty> : (
          <Table head={["Supplier", "Orders", "Terms", "Committed"]} align={[0, 1, 1, 1]}>
            {s.suppliers.map((sup) => (
              <tr key={sup.supplier}>
                <Td>{sup.supplier}</Td>
                <Td r>{sup.orders}</Td>
                <Td r>{sup.terms_days} days</Td>
                <Td r>{money(sup.committed)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <OrdersPanel orders={orders.filter((o) => o.source === tab)} roles={roles} canManage={canManage} onErr={setErr} onDone={() => router.refresh()} />

      {canManage && (
        <Panel title="Add purchases" note="key a line straight in, or bulk-load a CSV">
          <AddLine source={tab} onDone={() => router.refresh()} />
          <Upload onDone={() => router.refresh()} />
        </Panel>
      )}
      </>
      )}
    </>
  );
}

// A labelled field. Defined at module scope (not inside a component) so its
// identity is stable across renders — otherwise every keystroke remounts the
// input and it loses focus after a single character.
const FIELD_LAB = { fontSize: 10, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--faint)", fontFamily: "var(--mono)", marginBottom: 5, display: "block" };
function Field({ label, children }) {
  return <label style={{ display: "block" }}><span style={FIELD_LAB}>{label}</span>{children}</label>;
}

// Add a single purchase directly on the page — no spreadsheet. Example values sit
// in the placeholders so it's obvious what each field wants.
function AddLine({ source, onDone }) {
  const isMiniso = source === "MINISO";
  const empty = { supplier: "", category: "", order_ym: "", delivery_ym: "", amount_gbp: "", terms_days: "", pickup_date: "", status: "COMMITTED", reference: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const eg = isMiniso
    ? { supplier: "e.g. MINISO HQ (Guangzhou)", category: "e.g. Core range", amount: "e.g. 420000", ref: "e.g. PO-1042" }
    : { supplier: "e.g. Design360", category: "e.g. Fixtures", amount: "e.g. 42000", terms: "e.g. 30 days", ref: "e.g. PO-2087" };
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await post({ action: "purchase", source, ...f });
      setF(empty); setMsg("Added.");
      onDone();
    } catch (x) { setMsg(x.message); }
    finally { setBusy(false); }
  }
  const inp = { height: 32, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)", width: "100%" };
  return (
    <form onSubmit={submit} className="fos-card" style={{ padding: "15px 17px", marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>Add a {isMiniso ? "Miniso" : "Local"} purchase</div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 13, lineHeight: 1.5 }}>
        {isMiniso
          ? <>Miniso HQ settles on fixed <strong>180-day terms from the pickup date</strong> — enter the pickup date and the cash-out month is worked out automatically.</>
          : <>Enter a purchase directly — no spreadsheet needed. The cash-out month is the order month-end plus the supplier&rsquo;s payment terms.</>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        <Field label="Supplier"><input required value={f.supplier} onChange={set("supplier")} placeholder={eg.supplier} style={inp} /></Field>
        <Field label="Category"><input value={f.category} onChange={set("category")} placeholder={eg.category} style={inp} /></Field>
        <Field label="Order month"><input required type="month" value={f.order_ym} onChange={set("order_ym")} style={inp} /></Field>
        <Field label="Delivery month"><input type="month" value={f.delivery_ym} onChange={set("delivery_ym")} style={inp} /></Field>
        <Field label="Amount (£)"><input required type="number" min="0" step="0.01" value={f.amount_gbp} onChange={set("amount_gbp")} placeholder={eg.amount} style={{ ...inp, textAlign: "right" }} className="fos-num" /></Field>
        {isMiniso ? (
          <>
            <Field label="Pickup date"><input required type="date" value={f.pickup_date} onChange={set("pickup_date")} style={inp} /></Field>
            <Field label="Terms"><input value="180 days · from pickup" disabled style={{ ...inp, color: "var(--muted)" }} /></Field>
          </>
        ) : (
          <Field label="Terms (days)"><input type="number" min="0" value={f.terms_days} onChange={set("terms_days")} placeholder={eg.terms} style={{ ...inp, textAlign: "right" }} className="fos-num" /></Field>
        )}
        <Field label="Status"><select value={f.status} onChange={set("status")} style={inp}><option value="COMMITTED">Committed</option><option value="PAID">Paid</option></select></Field>
        <Field label="Reference"><input value={f.reference} onChange={set("reference")} placeholder={eg.ref} style={inp} /></Field>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
        <button type="submit" className="fos-btn" disabled={busy} style={{ height: 34, fontSize: 12.5 }}>{busy ? "Adding…" : "Add purchase"}</button>
        {msg && <span style={{ fontSize: 12, color: msg === "Added." ? "var(--green)" : "var(--red)" }}>{msg}</span>}
      </div>
    </form>
  );
}

// The raised orders with their approval lifecycle — raise → Head of Department
// sign-off → Finance → approved; cancel is the soft action, delete (Finance
// only, once head-approved) the hard one.
const hodApprovedStatus = (s) => s === "HOD_APPROVED" || s === "APPROVED";
function OrdersPanel({ orders, roles, canManage, onErr, onDone }) {
  const [busy, setBusy] = useState(null);
  const { isHod, isFinance } = roles || {};
  if (!orders.length) return null;

  async function act(id, action, extra) {
    onErr(""); setBusy(`${id}:${action}`);
    try { await post({ action, id, ...extra }); onDone(); }
    catch (x) { onErr(x.message); }
    finally { setBusy(null); }
  }
  const cancel = (o) => { const reason = window.prompt("Cancel this order — reason (optional):", ""); if (reason === null) return; act(o.purchase_id, "cancel", { reason }); };
  const del = (o) => { if (window.confirm(`Delete this order (${o.supplier}) permanently? This cannot be undone.`)) act(o.purchase_id, "delete"); };

  return (
    <Panel title="Orders" note="raise → head of department → finance · cancel any time; only finance can delete once head-approved">
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
          <thead><tr>
            {["Supplier", "Category", "Order", "Cash-out", "Amount", "Status", ""].map((h, i) => (
              <th key={i} style={{ textAlign: i === 4 ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {orders.map((o, i) => {
              const meta = PROC_STATUS_META[o.approval_status] || { label: o.approval_status, tone: "muted" };
              const bb = i === orders.length - 1 ? "none" : "1px solid var(--hairline)";
              const cancelled = o.approval_status === "CANCELLED";
              const btn = { fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" };
              return (
                <tr key={o.purchase_id} style={{ opacity: cancelled ? 0.55 : 1 }}>
                  <td style={{ padding: "9px 12px", borderBottom: bb, fontWeight: 550, textDecoration: cancelled ? "line-through" : "none" }}>{o.supplier}{o.reference ? <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {o.reference}</span> : null}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, color: "var(--muted)" }}>{o.category || "—"}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}>{monthLabel(o.order_ym)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap", color: "var(--muted)" }}>{monthLabel(cashOutFor(o))}</td>
                  <td className="fos-num" style={{ padding: "9px 12px", textAlign: "right", borderBottom: bb }}>{money(o.amount_gbp)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, textAlign: "right", whiteSpace: "nowrap" }}>
                    {cancelled ? <span style={{ fontSize: 11, color: "var(--faint)" }}>{o.cancel_reason ? `“${o.cancel_reason}”` : "—"}</span> : (
                      <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        {isHod && o.approval_status === "PENDING" && <button disabled={busy} style={{ ...btn, borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => act(o.purchase_id, "hod-approve")}>Approve (Head)</button>}
                        {isFinance && (o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED") && <button disabled={busy} style={{ ...btn, borderColor: "var(--green)", color: "var(--green)" }} onClick={() => act(o.purchase_id, "finance-approve")}>Approve (Finance)</button>}
                        {canManage && <button disabled={busy} style={btn} onClick={() => cancel(o)}>Cancel</button>}
                        {isFinance && hodApprovedStatus(o.approval_status) && <button disabled={busy} style={{ ...btn, borderColor: "var(--red)", color: "var(--red)" }} onClick={() => del(o)}>Delete</button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 26, fontWeight: 650, lineHeight: 1, color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}
function Panel({ title, note, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {note}</span>}
      </div>
      {children}
    </section>
  );
}
function Table({ head, align, children }) {
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 560 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: align[i] ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, r, tone }) {
  return <td className={r ? "fos-num" : undefined} style={{ textAlign: r ? "right" : "left", padding: "9px 14px", borderBottom: "1px solid var(--hairline)", color: tone || "var(--ink)", whiteSpace: "nowrap" }}>{children}</td>;
}
function Bar({ value, max, over }) {
  const w = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <span style={{ display: "inline-block", width: 80, height: 7, background: "var(--raise)", borderRadius: 4, overflow: "hidden", verticalAlign: "middle" }}>
    <span style={{ display: "block", width: `${w}%`, height: "100%", borderRadius: 4, background: over ? "var(--red)" : "linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent))" }} />
  </span>;
}
function Empty({ children }) { return <div className="fos-card" style={{ padding: "14px 18px", fontSize: 13, color: "var(--faint)" }}>{children}</div>; }

function Upload({ onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState("");
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setState("Loading…");
    try { const csv = await f.text(); const r = await post({ action: "upload", csv }); setState(`Loaded ${r.loaded} purchases${r.errors?.length ? ` · ${r.errors.length} skipped` : ""}.`); onDone(); }
    catch (x) { setState(x.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--faint)" }}>
      <button className="fos-btn-ghost" onClick={() => fileRef.current?.click()}>Upload purchases (CSV)</button>
      <a className="fos-btn-ghost" style={{ textDecoration: "none" }} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="procurement-template.csv">Template</a>
      <span>Source · Supplier · Category · Order Month · Amount · Terms (days) · Status · Reference.</span>
      {state && <span style={{ color: "var(--muted)" }}>{state}</span>}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
    </div>
  );
}

/* Merchandising requests — the OTB-linked channel request flow (moved here from the
   OTB workspace). Pick the OTB version, raise a request against a purchase channel;
   it is validated live against the approved Open-to-Buy before it becomes a
   commitment, then moves through merch → OTB → finance review and can generate a
   formal P.O without rekeying. */
function MerchRequests({ otbVersions = [], activeVersionId = null, requests = [], channelOpts = [], canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ channel_code: "", supplier: "", category: "", amount_gbp: "", otb_period: "", units: "", freight: "", duty: "", fx_rate: "", expected_receipt_date: "", reason: "" });
  const [avail, setAvail] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const version = otbVersions.find((v) => String(v.otb_version_id) === String(activeVersionId)) || null;

  const inp = { height: 32, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)", width: "100%" };
  const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
  const ghost = { fontSize: 12, fontWeight: 500, padding: "5px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

  // Live available-OTB preview once a channel + value are set.
  useEffect(() => {
    const value = Number(f.amount_gbp) || 0;
    if (!version || !f.channel_code || !(value > 0)) { setAvail(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/otb/requests", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "availability", otbVersionId: version.otb_version_id, channel: f.channel_code, period: f.otb_period || null, requestValue: value }),
        });
        const j = await res.json().catch(() => ({}));
        if (live && res.ok) setAvail(j.availability || null);
      } catch { /* preview is best-effort */ }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [f.channel_code, f.amount_gbp, f.otb_period, version?.otb_version_id]);

  function pickVersion(e) { router.push(`/operate/procurement?v=${e.target.value}`); }

  async function req(url, body) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || "Request failed"); return null; }
      router.refresh();
      return j;
    } catch (x) { setMsg(x.message); return null; }
    finally { setBusy(false); }
  }
  async function submit() {
    const j = await req("/api/otb/requests", { ...f, otb_version_id: version.otb_version_id });
    if (j) { setF({ channel_code: "", supplier: "", category: "", amount_gbp: "", otb_period: "", units: "", freight: "", duty: "", fx_rate: "", expected_receipt_date: "", reason: "" }); setMsg("Request added."); }
  }
  const reqOp = (id, body) => req(`/api/otb/requests/${id}`, body);

  if (!otbVersions.length) {
    return <Empty>No Open-to-Buy version is available yet. Create and approve an OTB version in <strong>Plan → OTB Planning</strong>, then raise merchandising requests here against it.</Empty>;
  }

  return (
    <>
      <div className="fos-card" style={{ padding: "15px 17px", marginBottom: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <Field label="OTB version">
          <select style={{ ...inp, width: "auto", minWidth: 220 }} value={version?.otb_version_id || ""} onChange={pickVersion}>
            {otbVersions.map((v) => <option key={v.otb_version_id} value={v.otb_version_id}>{v.label}{v.status ? ` · ${v.status}` : ""}</option>)}
          </select>
        </Field>
        <div style={{ fontSize: 11.5, color: "var(--faint)", maxWidth: 460, lineHeight: 1.5 }}>
          Requests are raised against the selected OTB version and validated against its approved Open-to-Buy. Approved requests consume the channel&rsquo;s remaining OTB and can generate a formal P.O.
        </div>
      </div>

      {msg && <div style={{ fontSize: 12.5, color: msg.includes("added") ? "var(--green)" : "var(--red)", marginBottom: 12 }}>{msg}</div>}

      {canManage && (
        <div className="fos-card" style={{ padding: "15px 17px", marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 3 }}>Add merchandising request</div>
          <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 13, lineHeight: 1.5 }}>Enter the channel, supplier and landed-cost detail. The available-OTB preview updates as you type.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Field label="Channel"><select style={inp} value={f.channel_code} onChange={set("channel_code")}><option value="">—</option>{channelOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Supplier"><input style={inp} value={f.supplier} onChange={set("supplier")} placeholder="e.g. MINISO HQ" /></Field>
            <Field label="Category"><input style={inp} value={f.category} onChange={set("category")} placeholder="e.g. Core range" /></Field>
            <Field label="Amount (£)"><input type="number" step="0.01" min="0" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.amount_gbp} onChange={set("amount_gbp")} placeholder="e.g. 250000" /></Field>
            <Field label="OTB period"><input placeholder="YYYY-MM" style={inp} value={f.otb_period} onChange={set("otb_period")} /></Field>
            <Field label="Units"><input type="number" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.units} onChange={set("units")} /></Field>
            <Field label="Freight (£)"><input type="number" step="0.01" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.freight} onChange={set("freight")} /></Field>
            <Field label="Duty (£)"><input type="number" step="0.01" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.duty} onChange={set("duty")} /></Field>
            <Field label="FX rate"><input type="number" step="0.0001" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.fx_rate} onChange={set("fx_rate")} /></Field>
            <Field label="Expected receipt"><input type="date" style={inp} value={f.expected_receipt_date} onChange={set("expected_receipt_date")} /></Field>
            <Field label="Reason"><input style={inp} value={f.reason} onChange={set("reason")} /></Field>
          </div>

          {avail && (
            <div style={{ marginTop: 14, borderRadius: 10, padding: "12px 14px",
              border: `1px solid ${VAL_TONE[avail.status] === "red" ? "var(--red)" : VAL_TONE[avail.status] === "amber" ? "var(--amber)" : "var(--line)"}`,
              background: VAL_TONE[avail.status] === "red" ? "var(--red-bg)" : VAL_TONE[avail.status] === "amber" ? "var(--amber-bg)" : "var(--raise)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={lab}>Available OTB</span>
                <Badge tone={VAL_TONE[avail.status] || "muted"}>{(avail.status || "").replace(/_/g, " ")}</Badge>
              </div>
              {[["Approved OTB", money(avail.approvedOtb)], ["Remaining", money(avail.remaining ?? avail.remainingBefore)], ["This request", money(Number(f.amount_gbp) || 0)], ["Remaining after", money(avail.remainingAfter)]].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                  <span style={{ color: "var(--muted)" }}>{l}</span><span style={{ color: "var(--ink)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button style={btn("var(--accent)")} disabled={busy || !version || !f.channel_code || !f.supplier || !(Number(f.amount_gbp) > 0)} onClick={submit}>{busy ? "Saving…" : "Add request"}</button>
          </div>
        </div>
      )}

      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
          <thead><tr>{["Channel", "Supplier", "Amount", "Period", "Status", "OTB check", "Actions"].map((h, i) => (
            <th key={h} style={{ textAlign: i === 2 ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {!requests.length ? <tr><td style={{ padding: "12px 14px", color: "var(--faint)" }} colSpan={7}>No requests for this version yet.</td></tr> :
              requests.map((r) => {
                const acts = REQ_ACTIONS[r.request_status] || [];
                return (
                  <tr key={r.purchase_id}>
                    <Td>{r.channel_code}</Td>
                    <Td>{r.supplier}</Td>
                    <Td r>{money(r.amount_gbp)}</Td>
                    <Td>{r.otb_period || "—"}</Td>
                    <Td><Badge tone="muted">{(r.request_status || "").replace(/_/g, " ")}</Badge></Td>
                    <Td>{r.validation_status ? <Badge tone={VAL_TONE[r.validation_status] || "muted"}>{r.validation_status.replace(/_/g, " ")}</Badge> : "—"}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {canManage && acts.map(([action, label]) => (
                          <button key={action} style={action === "reject" ? { ...ghost, color: "var(--red)" } : ghost} disabled={busy} onClick={() => reqOp(r.purchase_id, { op: "transition", action })}>{label}</button>
                        ))}
                        {canManage && r.validation_status === "EXCEEDS_OTB" && (
                          <button style={{ ...ghost, color: "var(--amber)" }} disabled={busy} onClick={() => { const reason = window.prompt("Reason for the OTB exception?"); if (reason) reqOp(r.purchase_id, { op: "exception", reason }); }}>Record exception</button>
                        )}
                        {canManage && r.request_status === "APPROVED" && (
                          <button style={btn("var(--green)")} disabled={busy} onClick={() => reqOp(r.purchase_id, { op: "generate-po" })}>Generate P.O</button>
                        )}
                        {!canManage && !acts.length && <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
}
