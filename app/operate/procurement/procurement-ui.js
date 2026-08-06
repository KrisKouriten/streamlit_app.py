"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, Badge, IllustrativeBanner } from "../../finance-os/ui";
import { cashOutFor, PROC_STATUS_META } from "../../../lib/procurement-rules";
import { FX_RATE_TYPES, FX_RATE_LABEL, isForeignCurrency, findRate, convertToGbp, fxVariance } from "../../../lib/fx-rules";

/* Procurement Request UI: four sections. Miniso / Local are the cash-tracker
   purchases (monthly cash budget vs committed spend, bucketed by supplier payment
   terms). Merchandising requests raise an OTB-validated channel request (moved
   here from the OTB workspace) against the approved Open-to-Buy. Exchange rates
   holds the USD→GBP spot / hedged / costing rates Finance converts at. */

const SECTIONS = [["MINISO", "Miniso purchases"], ["LOCAL", "Local purchases"], ["MERCH", "Merchandising requests"], ["FX", "Exchange rates"]];
// Currencies a purchase can be raised in. USD converts to GBP at a chosen rate.
const CCY_OPTS = [["GBP", "£ GBP"], ["USD", "$ USD"]];
const CCY_SYMBOL = { GBP: "£", USD: "$" };
const ccyMoney = (v, ccy) => (isForeignCurrency(ccy) ? `${CCY_SYMBOL[ccy] || ""}${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : money(v));
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
// The submitter, stored as an email or name — show a readable form.
const submitterName = (v) => (v ? String(v).split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

async function post(body) {
  const res = await fetch("/api/procurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function ProcurementUI({ data, ready, loaded, illustrative, canManage, orders = [], roles = {}, fxRates = [], otbVersions = [], activeVersionId = null, merchRequests = [], channelOpts = [] }) {
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
  const isFx = tab === "FX";
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

      {isFx ? (
        <FxPanel rates={fxRates} isFinance={roles.isFinance} onErr={setErr} onDone={() => router.refresh()} />
      ) : isMerch ? (
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

      <OrdersPanel orders={orders.filter((o) => o.source === tab)} roles={roles} canManage={canManage} fxRates={fxRates} onErr={setErr} onDone={() => router.refresh()} />

      {canManage && (
        <Panel title="Add purchases" note="key a line straight in, or bulk-load a CSV">
          <AddLine source={tab} fxRates={fxRates} onDone={() => router.refresh()} />
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
function AddLine({ source, fxRates = [], onDone }) {
  const isMiniso = source === "MINISO";
  // Miniso HQ raises in USD; local suppliers in GBP.
  const defaultCcy = isMiniso ? "USD" : "GBP";
  const empty = { supplier: "", category: "", order_ym: "", delivery_ym: "", amount_gbp: "", currency: defaultCcy, terms_days: "", pickup_date: "", status: "COMMITTED", reference: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const foreign = isForeignCurrency(f.currency);
  const spot = findRate(fxRates, f.currency, "SPOT");
  const gbpPreview = foreign ? convertToGbp(f.amount_gbp, spot) : null;
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
        <Field label="Currency"><select value={f.currency} onChange={set("currency")} style={inp}>{CCY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label={`Amount (${CCY_SYMBOL[f.currency] || f.currency})`}><input required type="number" min="0" step="0.01" value={f.amount_gbp} onChange={set("amount_gbp")} placeholder={eg.amount} style={{ ...inp, textAlign: "right" }} className="fos-num" /></Field>
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
      {foreign && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 11, lineHeight: 1.5 }}>
          {spot == null
            ? <>No USD spot rate is set yet — add one on the <strong>Exchange rates</strong> tab before raising a USD order.</>
            : <>Provisionally ≈ <strong>{money(gbpPreview)}</strong> at the {money(1)}=${spot} spot rate. Finance re-strikes the GBP cost at the chosen rate on approval.</>}
        </div>
      )}
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
function OrdersPanel({ orders, roles, canManage, fxRates = [], onErr, onDone }) {
  const [busy, setBusy] = useState(null);
  const [fxApprove, setFxApprove] = useState(null);   // purchase_id awaiting the FX rate picks
  const { isHod, isFinance } = roles || {};
  if (!orders.length) return null;

  async function act(id, action, extra) {
    onErr(""); setBusy(`${id}:${action}`);
    try { await post({ action, id, ...extra }); setFxApprove(null); onDone(); }
    catch (x) { onErr(x.message); }
    finally { setBusy(null); }
  }
  const cancel = (o) => { const reason = window.prompt("Cancel this order — reason (optional):", ""); if (reason === null) return; act(o.purchase_id, "cancel", { reason }); };
  const del = (o) => { if (window.confirm(`Delete this order (${o.supplier}) permanently? This cannot be undone.`)) act(o.purchase_id, "delete"); };
  // GBP orders approve in one click; a foreign order opens the rate pickers first.
  const financeApprove = (o) => (isForeignCurrency(o.currency) ? setFxApprove(fxApprove === o.purchase_id ? null : o.purchase_id) : act(o.purchase_id, "finance-approve"));

  return (
    <Panel title="Orders" note="raise → head of department → finance · cancel any time; only finance can delete once head-approved">
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 860 }}>
          <thead><tr>
            {["Supplier", "Category", "Submitted by", "Order", "Cash-out", "Amount", "Status", ""].map((h, i) => (
              <th key={i} style={{ textAlign: i === 5 ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {orders.map((o, i) => {
              const meta = PROC_STATUS_META[o.approval_status] || { label: o.approval_status, tone: "muted" };
              const last = i === orders.length - 1 && fxApprove !== o.purchase_id;
              const bb = last ? "none" : "1px solid var(--hairline)";
              const cancelled = o.approval_status === "CANCELLED";
              const foreign = isForeignCurrency(o.currency);
              const approved = o.approval_status === "APPROVED";
              const btn = { fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" };
              return (
                <Fragment key={o.purchase_id}>
                <tr style={{ opacity: cancelled ? 0.55 : 1 }}>
                  <td style={{ padding: "9px 12px", borderBottom: bb, fontWeight: 550, textDecoration: cancelled ? "line-through" : "none" }}>{o.supplier}{o.reference ? <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {o.reference}</span> : null}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, color: "var(--muted)" }}>{o.category || "—"}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, color: "var(--muted)", whiteSpace: "nowrap" }}>{submitterName(o.created_by)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}>{monthLabel(o.order_ym)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap", color: "var(--muted)" }}>{monthLabel(cashOutFor(o))}</td>
                  <td className="fos-num" style={{ padding: "9px 12px", textAlign: "right", borderBottom: bb, whiteSpace: "nowrap" }}>
                    {money(o.amount_gbp)}
                    {foreign && <div style={{ fontSize: 10.5, color: "var(--faint)", fontWeight: 400 }}>{ccyMoney(o.amount_ccy, o.currency)} {o.currency}{approved && o.cost_rate_type ? ` · ${FX_RATE_LABEL[o.cost_rate_type] || o.cost_rate_type}` : ""}</div>}
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, textAlign: "right", whiteSpace: "nowrap" }}>
                    {cancelled ? <span style={{ fontSize: 11, color: "var(--faint)" }}>{o.cancel_reason ? `“${o.cancel_reason}”` : "—"}</span> : (
                      <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        {isHod && o.approval_status === "PENDING" && <button disabled={busy} style={{ ...btn, borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => act(o.purchase_id, "hod-approve")}>Approve (Head)</button>}
                        {isFinance && (o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED") && <button disabled={busy} style={{ ...btn, borderColor: "var(--green)", color: "var(--green)" }} onClick={() => financeApprove(o)}>{foreign ? "Approve (Finance)…" : "Approve (Finance)"}</button>}
                        {canManage && <button disabled={busy} style={btn} onClick={() => cancel(o)}>Cancel</button>}
                        {isFinance && hodApprovedStatus(o.approval_status) && <button disabled={busy} style={{ ...btn, borderColor: "var(--red)", color: "var(--red)" }} onClick={() => del(o)}>Delete</button>}
                      </span>
                    )}
                  </td>
                </tr>
                {fxApprove === o.purchase_id && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0, borderBottom: i === orders.length - 1 ? "none" : "1px solid var(--hairline)", background: "var(--raise)" }}>
                      <FxApprove order={o} rates={fxRates} busy={busy} onCancel={() => setFxApprove(null)} onConfirm={(picks) => act(o.purchase_id, "finance-approve", picks)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// The two FX rate picks Finance makes when approving a foreign-currency order:
// the actual-cost rate settles the cashflow; the arrival rate values stock. The
// gap between the two GBP figures is the FX gain/loss booked to the P&L.
function FxApprove({ order, rates, busy, onCancel, onConfirm }) {
  const [cost, setCost] = useState("SPOT");
  const [stock, setStock] = useState("COSTING");
  const costRate = findRate(rates, order.currency, cost);
  const stockRate = findRate(rates, order.currency, stock);
  const cashflow = convertToGbp(order.amount_ccy, costRate);
  const stockVal = convertToGbp(order.amount_ccy, stockRate);
  const variance = fxVariance(stockVal, cashflow);
  const sel = { height: 30, fontSize: 12, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", width: "100%" };
  const rateOpts = (ccy) => FX_RATE_TYPES.map((t) => { const r = findRate(rates, ccy, t.key); return <option key={t.key} value={t.key}>{t.label}{r != null ? ` · ${money(1)}=$${r}` : " · not set"}</option>; });
  const missing = costRate == null || stockRate == null;
  return (
    <div style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 3 }}>Approve {ccyMoney(order.amount_ccy, order.currency)} {order.currency} — pick the conversion rates</div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12, lineHeight: 1.5 }}>The <strong>actual-cost</strong> rate is what settles in cashflow; the <strong>arrival valuation</strong> rate is the value booked to closing stock. Their difference posts to the P&L.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
        <div>
          <span style={FIELD_LAB}>Actual cost (cashflow)</span>
          <select value={cost} onChange={(e) => setCost(e.target.value)} style={sel}>{rateOpts(order.currency)}</select>
          <div style={{ fontSize: 12, marginTop: 6, color: "var(--ink)" }}>Pays <strong>{cashflow == null ? "—" : money(cashflow)}</strong></div>
        </div>
        <div>
          <span style={FIELD_LAB}>Value reported on arrival (stock)</span>
          <select value={stock} onChange={(e) => setStock(e.target.value)} style={sel}>{rateOpts(order.currency)}</select>
          <div style={{ fontSize: 12, marginTop: 6, color: "var(--ink)" }}>Books <strong>{stockVal == null ? "—" : money(stockVal)}</strong> to stock</div>
        </div>
        <div>
          <span style={FIELD_LAB}>FX to P&amp;L</span>
          <div className="fos-num" style={{ fontSize: 18, fontWeight: 650, marginTop: 2, color: variance == null ? "var(--muted)" : variance >= 0 ? "var(--green)" : "var(--red)" }}>{variance == null ? "—" : money(variance)}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>stock value − cash cost</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button className="fos-btn" disabled={busy || missing} style={{ height: 32, fontSize: 12.5 }} onClick={() => onConfirm({ cost_rate_type: cost, stock_rate_type: stock })}>Approve at these rates</button>
        <button className="fos-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        {missing && <span style={{ fontSize: 11.5, color: "var(--amber)" }}>Set the {order.currency} rates on the Exchange rates tab first.</span>}
      </div>
    </div>
  );
}

/* Exchange rates — the USD→GBP rates Finance converts procurement at. Three
   rate types (spot / hedged / costing), quoted as USD per £1 (GBPUSD). Editable
   by Finance; everyone else sees the current rates read-only. */
function FxPanel({ rates = [], isFinance, onErr, onDone }) {
  const rowFor = (rt) => rates.find((r) => String(r.currency).toUpperCase() === "USD" && String(r.rate_type).toUpperCase() === rt) || {};
  const [busy, setBusy] = useState(null);

  async function save(rt, rate, note) {
    onErr(""); setBusy(rt);
    try { await post({ action: "set-fx-rate", currency: "USD", rate_type: rt, rate: Number(rate), note }); onDone(); }
    catch (x) { onErr(x.message); }
    finally { setBusy(null); }
  }

  if (!rates.length) {
    return <Empty>Run migration <span style={{ fontFamily: "var(--mono)" }}>085_fx_rates.sql</span> (idempotent) to enable USD exchange rates, then refresh.</Empty>;
  }

  const inp = { height: 30, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" };
  return (
    <Panel title="USD → GBP exchange rates" note="quoted as USD per £1 (GBPUSD) — GBP = USD amount ÷ rate">
      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 14, lineHeight: 1.55, maxWidth: 620 }}>
        A USD procurement order is provisionally converted at the <strong>spot</strong> rate when raised. On Finance approval the <strong>actual-cost</strong> rate settles the cashflow and the <strong>arrival valuation</strong> rate values closing stock — the gap between the two posts to the P&amp;L.
      </div>
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
          <thead><tr>{["Rate", "What it's for", "USD per £1", "Updated", isFinance ? "" : null].filter((h) => h !== null).map((h, i) => (
            <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {FX_RATE_TYPES.map((t, i) => {
              const row = rowFor(t.key);
              const bb = i === FX_RATE_TYPES.length - 1 ? "none" : "1px solid var(--hairline)";
              return (
                <tr key={t.key}>
                  <Td>{t.label}</Td>
                  <td style={{ padding: "9px 14px", borderBottom: bb, color: "var(--muted)" }}>{t.hint}</td>
                  <td className="fos-num" style={{ padding: "9px 14px", textAlign: "right", borderBottom: bb, fontWeight: 600 }}>{row.rate != null ? Number(row.rate).toFixed(4) : "—"}</td>
                  <td style={{ padding: "9px 14px", borderBottom: bb, color: "var(--faint)", fontSize: 11.5, whiteSpace: "nowrap" }}>{row.updated_at ? new Date(row.updated_at).toLocaleDateString("en-GB") : "—"}{row.updated_by && row.updated_by !== "seed" ? ` · ${submitterName(row.updated_by)}` : ""}</td>
                  {isFinance && (
                    <td style={{ padding: "9px 14px", borderBottom: bb, textAlign: "right", whiteSpace: "nowrap" }}>
                      <RateEditor rate={row.rate} note={row.note} busy={busy === t.key} onSave={(rate, note) => save(t.key, rate, note)} inp={inp} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!isFinance && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>Only Finance can amend the exchange rates.</div>}
    </Panel>
  );
}

// Inline rate + note editor for one FX rate row.
function RateEditor({ rate, note, busy, onSave, inp }) {
  const [r, setR] = useState(rate != null ? String(rate) : "");
  const [n, setN] = useState(note || "");
  useEffect(() => { setR(rate != null ? String(rate) : ""); setN(note || ""); }, [rate, note]);
  const dirty = r !== (rate != null ? String(rate) : "") || n !== (note || "");
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <input type="number" step="0.0001" min="0" value={r} onChange={(e) => setR(e.target.value)} placeholder="1.2700" style={{ ...inp, width: 92, textAlign: "right" }} className="fos-num" />
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="note (optional)" style={{ ...inp, width: 160 }} />
      <button className="fos-btn" disabled={busy || !dirty || !(Number(r) > 0)} style={{ height: 30, fontSize: 12 }} onClick={() => onSave(r, n)}>{busy ? "Saving…" : "Save"}</button>
    </span>
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
