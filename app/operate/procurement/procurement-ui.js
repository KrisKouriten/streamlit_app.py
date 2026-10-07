"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, pct, Badge, IllustrativeBanner } from "../../finance-os/ui";
import { cashOutFor, PROC_STATUS_META, budgetImpact, requestsVsBudget, tradeFacilitySplit, financeChallenge, challengedOrders, monthsWithActivity, REQUEST_VIEWS, orderInvoiceError, orderPaid } from "../../../lib/procurement-rules";
import { procRef } from "../../../lib/procurement-close-rules";
import { invoiceMatch } from "../../../lib/po-rules";
import { challengeReasonLabels } from "../../../lib/procurement-close-rules";
import { challengeLapse, lapseNote } from "../../../lib/auto-workflow-rules.js";
import { FX_RATE_TYPES, FX_RATE_LABEL, isForeignCurrency, findRate, convertToGbp, fxVariance } from "../../../lib/fx-rules";
import { supplierTermsPosition, supplierDueDate, supplierTermsDate, ukPaymentDate } from "../../../lib/supplier-terms-rules";
import { orderEditError, orderAmount } from "../../../lib/procurement-edit-rules";
import { VAT_TREATMENTS, VAT_STANDARD, defaultVatRate, grossFromNet, vatRateOf, grossOf, netOf, vatLabel, netVat, vatEntryError } from "../../../lib/vat-rules";
import MoneyInput from "../../money-input";
import SupplierPicker from "../supplier-picker";

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
  // MERCH_REVIEW is the head-of-department sign-off (the Merchandising Department
  // sign-off approver, e.g. Becky). On approval it goes straight to Finance.
  MERCH_REVIEW: [["hod_approve", "Approve (sign-off)"], ["reject", "Reject"]],
  OTB_VALIDATED: [["finance", "To finance"], ["reject", "Reject"]],
  FINANCE_REVIEW: [["approve", "Approve"], ["reject", "Reject"]],
  APPROVED: [["order", "Mark ordered"]],
};
const CSV_TEMPLATE = "Source,Supplier,Category,Order Month,Amount,Terms (days),Status,Reference\nMiniso,MINISO HQ,Core range,2026-07,420000,60,Committed,PO-1\nLocal,Design360,Fixtures,2026-07,42000,30,Committed,PO-2\n";
const dmyOf = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
// Month arithmetic on "YYYY-MM" strings (they sort lexically, so comparisons work).
const thisYm = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const ymAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const ymRange = (start, end) => { const out = []; let c = start; for (let i = 0; c <= end && i < 600; i++) { out.push(c); c = ymAdd(c, 1); } return out; };
// The submitter, stored as an email or name — show a readable form.
const submitterName = (v) => (v ? String(v).split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

async function post(body) {
  const res = await fetch("/api/procurement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function ProcurementUI({ data, ready, loaded, illustrative, canManage, orders = [], roles = {}, fxRates = [], otbVersions = [], activeVersionId = null, merchRequests = [], channelOpts = [], supplierNames = [], suppliers = [], amendments = {}, openOrder = null }) {
  const router = useRouter();
  // A link from a dashboard (?order=ID) opens on that order's own tab.
  const linked = openOrder != null ? orders.find((o) => String(o.purchase_id) === String(openOrder)) : null;
  const [tab, setTab] = useState(linked && (linked.source === "MINISO" || linked.source === "LOCAL") ? linked.source : "MINISO");
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
  /*
   * Miniso settles on POST-SHIPMENT BUYER LOANS against a letter of credit.
   * Those are drawings on the HSBC trade facility, but they are not TradePay —
   * TradePay is the product Local buys on. Calling the column "Trade pay" under
   * Miniso named the wrong instrument for every row in it.
   */
  const tradeLabel = tab === "MINISO" ? "Trade facility" : "Trade pay";
  // Months with nothing in them are budget rows waiting for activity. Useful to
  // see, but not while reading a month that is actually moving — so the table
  // opens on the months that have something in them.
  const [allMonths, setAllMonths] = useState(false);
  const monthsShown = useMemo(
    () => (allMonths ? (s?.months || []) : monthsWithActivity(s?.months)),
    [s, allMonths]);

  return (
    <>
      {/* Shared canonical-supplier suggestions for the free-text supplier inputs. */}
      <datalist id="fos-suppliers">{supplierNames.map((n) => <option key={n} value={n} />)}</datalist>
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
        <MerchRequests otbVersions={otbVersions} activeVersionId={activeVersionId} requests={merchRequests} channelOpts={channelOpts} canManage={canManage} isMerchApprover={!!roles.isMerchApprover} suppliers={suppliers} />
      ) : (
      <>
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
        <Tile label="Committed spend" value={money(s.totalCommitted, { compact: true })} sub="all months" />
        <Tile label="Spent" value={money(s.totalSpent, { compact: true })}
          sub={s.unvaluedDrawings ? `${s.unvaluedDrawings} drawing${s.unvaluedDrawings === 1 ? "" : "s"} unpriced` : "trade pay + cash settled · net of VAT"}
          tone={s.unvaluedDrawings ? "var(--amber)" : undefined} />
        <Tile label="Cash budget" value={money(s.totalBudget, { compact: true })} sub="sum of monthly budgets · net of VAT" />
        <Tile label="Over-budget months" value={s.months.filter((m) => m.overBudget).length} tone={s.months.some((m) => m.overBudget) ? "var(--red)" : "var(--green)"} sub="cash-out basis" />
        <Tile label="Suppliers" value={s.suppliers.length} sub="with orders" />
      </div>

      <Panel
        title="Monthly cash budget vs committed"
        note={`everything here is on a payment-date basis: committed lands in the month the entered payment terms make it fall due, ${tradeLabel.toLowerCase()} in the month its facility drawing is due, cash in the month it was paid · all figures are net of VAT, like the budget${s.totalSpentVat ? ` (${money(s.totalSpentVat, { compact: true })} VAT taken off ${tradeLabel.toLowerCase()} drawings)` : ""} · variance = budget − committed − ${tradeLabel.toLowerCase()} − cash + FX`}
        right={s.months.length > monthsShown.length || allMonths ? (
          <button className="fos-btn-ghost" onClick={() => setAllMonths((x) => !x)}>
            {allMonths ? "Months with activity" : `All months (${s.months.length})`}
          </button>
        ) : null}
      >
        {!allMonths && s.months.length > monthsShown.length && (
          <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 10 }}>
            Showing {monthsShown.length} of {s.months.length} months — the rest carry a budget but no committed orders or spend yet.
          </div>
        )}
        {s.unvaluedDrawings > 0 && (
          <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 10, lineHeight: 1.5 }}>
            {s.unvaluedDrawings} facility drawing{s.unvaluedDrawings === 1 ? " is" : "s are"} not counted in {tradeLabel.toLowerCase()} — no GBP amount on the upload, and no spot rate set for the drawing&rsquo;s currency. Set the rate on <strong>Exchange rates</strong>, or add a GBP column to the facility extract.
          </div>
        )}
        {s.months.length === 0 ? <Empty>No purchases or budgets for this section yet.</Empty> : (
          <Table head={["Cash-out month", "Committed", tradeLabel, "Cash", "Spent", "Budget", "FX", "Variance", "", "Status"]} align={[0, 1, 1, 1, 1, 1, 1, 1, 1, 0]}>
            {monthsShown.map((m) => (
              <tr key={m.ym}>
                <Td>{monthLabel(m.ym)}</Td>
                <Td r>{money(m.committed)}</Td>
                <Td r>
                  {m.tradeSpent ? money(m.tradeSpent) : <span style={{ color: "var(--faint)" }}>—</span>}
                  {/* Drawings pay the gross invoice; the budget is ex-VAT. What
                      came off, so the figure ties back to the facility extract. */}
                  {m.spentVat ? <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>net · {money(m.spentVat, { compact: true })} VAT off</div> : null}
                </Td>
                <Td r>{m.cashSpent ? money(m.cashSpent) : <span style={{ color: "var(--faint)" }}>—</span>}</Td>
                <Td r>
                  {m.spent ? money(m.spent) : <span style={{ color: "var(--faint)" }}>—</span>}
                  {/* Miniso stock settles two ways — a loan against a letter of
                      credit, or the same stock on TradePay — so spend is two
                      instruments added together. Named, so the total does not
                      have to be taken on trust. */}
                  {m.spent > 0 && Object.keys(m.spentByDriver || {}).length > 1 && (
                    <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4, whiteSpace: "normal", lineHeight: 1.4 }}>
                      {Object.entries(m.spentByDriver).sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k} ${money(v, { compact: true })}`).join(" · ")}
                    </div>
                  )}
                </Td>
                <Td r>{m.budget == null ? <span style={{ color: "var(--faint)" }}>—</span> : money(m.budget)}</Td>
                {/* The commitment is held at the costing rate and the cash goes
                    out at spot, so part of what `committed` shows is valuation,
                    not budget. Shown here rather than buried in variance, where
                    it read as over-spend. */}
                <Td r tone={m.fx ? "var(--muted)" : undefined}>{m.fx ? money(m.fx) : <span style={{ color: "var(--faint)" }}>—</span>}</Td>
                <Td r tone={m.variance == null ? undefined : m.variance < 0 ? "var(--red)" : "var(--green)"}>{m.variance == null ? "—" : money(m.variance)}</Td>
                {/* Same basis as overBudget and variance, so the bar, the badge
                    and the number cannot disagree with one another. */}
                <Td r>{m.budget ? <Bar value={m.committed + m.spent - (m.fx || 0)} max={m.budget} over={m.overBudget} /> : null}</Td>
                <Td>{m.budget == null ? <span style={{ color: "var(--faint)" }}>no budget</span> : <Badge tone={m.overBudget ? "red" : "green"}>{m.overBudget ? "Over" : "Within"}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {canManage && <AwaitingVsBudget rows={orders.filter((o) => o.source === tab)} months={s.months} />}

      <SupplierTerms orders={orders.filter((o) => o.source === tab)} suppliers={suppliers} />

      <OrdersPanel key={tab} orders={orders.filter((o) => o.source === tab)} openOrder={openOrder} amendments={amendments} roles={roles} canManage={canManage} fxRates={fxRates} suppliers={suppliers} onErr={setErr} onDone={() => router.refresh()} />

      {canManage && (
        <Panel title="Add purchases" note="key a line straight in, or bulk-load a CSV">
          <AddLine source={tab} fxRates={fxRates} suppliers={suppliers} months={s.months} onDone={() => router.refresh()} />
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

// Finance control: the requests still awaiting a decision, in the month each
// falls due, against the budget set for it. The table above shows what is
// already committed; this shows the pressure still coming, so Finance can see a
// month about to be taken over before they approve into it.
//
// On this page "awaiting" means the raise lifecycle: raised but not yet through
// Finance sign-off. Cancelled requests are not pressure and drop out.
const AWAITING_APPROVAL = (o) => o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED";
function AwaitingVsBudget({ rows = [], months = [] }) {
  const live = rows.filter((o) => o.approval_status !== "CANCELLED");
  const pipeline = requestsVsBudget(live, months, AWAITING_APPROVAL);
  if (!pipeline.length) return null;
  return (
    <Panel title="Awaiting sign-off vs budget" note="every request counted once — awaiting is still to be signed off, approved is already committed, and would commit is the two together. Open to buy is budget − committed − spent + FX for the month the cash leaves, where FX is the difference between holding a commitment at the costing rate and settling it at spot">
      <Table head={["Cash-out month", "Requests", "Awaiting", "Approved", "Would commit", "Budget", "FX", "Open to buy", "If approved", "Status"]} align={[0, 1, 1, 1, 1, 1, 1, 1, 1, 0]}>
        {pipeline.map((m) => (
          <tr key={m.ym}>
            <Td>{monthLabel(m.ym)}</Td>
            <Td r>{m.awaitingCount}</Td>
            <Td r>{money(m.awaiting)}</Td>
            <Td r>{m.committed ? money(m.committed) : <span style={{ color: "var(--faint)" }}>—</span>}</Td>
            <Td r>{money(m.wouldCommit)}</Td>
            <Td r>{m.noBudget ? <span style={{ color: "var(--faint)" }}>—</span> : money(m.budget)}</Td>
            {/* Open to buy adds this back, so it has to be visible. A figure
                that moves the headroom cannot live only in the note. */}
            <Td r tone={m.fx ? "var(--muted)" : undefined}>{m.fx ? money(m.fx) : <span style={{ color: "var(--faint)" }}>—</span>}</Td>
            <Td r tone={m.noBudget ? undefined : m.over ? "var(--red)" : "var(--green)"}>
              {m.noBudget ? "—" : `${m.headroom < 0 ? "−" : ""}${money(Math.abs(m.headroom))}`}
            </Td>
            <Td r tone={m.noBudget ? undefined : m.headroomIfApproved < 0 ? "var(--red)" : "var(--green)"}>
              {m.noBudget ? "—" : `${m.headroomIfApproved < 0 ? "−" : ""}${money(Math.abs(m.headroomIfApproved))}`}
            </Td>
            <Td>
              {m.noBudget
                ? <span style={{ color: "var(--faint)" }}>no budget</span>
                : <Badge tone={m.over ? "red" : m.wouldGoOver ? "amber" : "green"}>{m.over ? "Over" : m.wouldGoOver ? "Would go over" : "Within"}</Badge>}
            </Td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

// Add a single purchase directly on the page — no spreadsheet. Example values sit
// in the placeholders so it's obvious what each field wants.
function AddLine({ source, fxRates = [], suppliers = [], months = [], onDone }) {
  const isMiniso = source === "MINISO";
  // Miniso HQ raises in USD; local suppliers in GBP.
  const defaultCcy = isMiniso ? "USD" : "GBP";
  // vat_rate defaults by source: 20% for Local and Merch, none for Miniso —
  // import VAT goes to HMRC at the border, not to the supplier, so it is not
  // part of what the LC draws. Merch can change it either way.
  const empty = { supplier: "", category: "", order_ym: "", delivery_ym: "", amount_gbp: "", currency: defaultCcy, terms_days: "", pickup_date: "", status: "COMMITTED", reference: "", vat_rate: String(defaultVatRate({ source })) };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  // Supplier is chosen from the master (keeps names consistent). The Miniso tab
  // lists MINISO-classified suppliers; the Local tab lists everything else. If
  // none match yet, fall back to the whole list so the picker is never empty.
  const bySource = suppliers.filter((sp) => (isMiniso ? sp.source_type === "MINISO" : sp.source_type !== "MINISO"));
  const supplierOpts = bySource.length ? bySource : suppliers;
  // Picking a supplier pre-fills the payment terms from the master (Local only —
  // Miniso HQ is fixed 180-day from pickup). A freshly added supplier has no terms
  // yet, so the field is simply left as typed.
  function pickSupplierName(name) {
    const sup = suppliers.find((sp) => sp.name === name);
    setF((p) => ({ ...p, supplier: name, terms_days: !isMiniso && sup && sup.payment_days != null ? String(sup.payment_days) : p.terms_days }));
  }
  const foreign = isForeignCurrency(f.currency);
  const spot = findRate(fxRates, f.currency, "SPOT");
  const gbpPreview = foreign ? convertToGbp(f.amount_gbp, spot) : null;
  // Where this request would land, and what it does to that month's budget. The
  // GBP value is the spot conversion for a foreign order (Finance re-strikes it
  // on approval, so this is provisional) and the entered amount for a GBP one.
  /*
   * Net in, net committed.
   *
   * Merch enters the net value on the quote, and the procurement budgets Merch
   * upload are ex-VAT too — so the budget check is struck on the net, like for
   * like. The gross is still shown, because it is the cash that leaves (VAT is
   * paid to the supplier and reclaimed from HMRC later), but it is not what the
   * budget is charged.
   */
  const vatRate = vatRateOf({ source, currency: f.currency, vat_rate: f.vat_rate });
  const draftNet = foreign ? gbpPreview : Number(f.amount_gbp) || 0;
  const draftGross = grossFromNet(draftNet, vatRate);
  const draftVat = draftGross == null ? null : draftGross - (draftNet || 0);
  const draftGbp = draftNet;
  // Miniso's month comes off the pickup date, Local's off the order month, so
  // wait for the field that actually decides it — guessing from a half-filled
  // form would point at the wrong month's budget.
  const split = isMiniso ? null : tradeFacilitySplit(f.terms_days);
  const haveMonth = isMiniso ? !!f.pickup_date : !!f.order_ym;
  const draftYm = haveMonth
    ? cashOutFor({ source, order_ym: f.order_ym, terms_days: f.terms_days, pickup_date: f.pickup_date })
    : null;
  const impact = budgetImpact(months, draftYm, draftGbp);
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
          : <>Enter a purchase directly — no spreadsheet needed. Local purchases settle on the <strong>180-day trade facility</strong>, so the cash-out month is the order month-end plus 180 days; the supplier&rsquo;s terms set when the drawdown pays them.</>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        <Field label="Supplier">
          <SupplierPicker options={supplierOpts} value={f.supplier} onChange={pickSupplierName} selectStyle={inp} required />
        </Field>
        <Field label="Category"><input value={f.category} onChange={set("category")} placeholder={eg.category} style={inp} /></Field>
        <Field label="Order month"><input required type="month" value={f.order_ym} onChange={set("order_ym")} style={inp} /></Field>
        <Field label="Delivery month"><input type="month" value={f.delivery_ym} onChange={set("delivery_ym")} style={inp} /></Field>
        {/* Changing the currency resets the VAT to its default for it — an
            order from abroad carries no UK VAT. */}
        <Field label="Currency"><select value={f.currency} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, currency: v, vat_rate: String(defaultVatRate({ source, currency: v })) })); }} style={inp}>{CCY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label={`Net amount (${CCY_SYMBOL[f.currency] || f.currency})`}><MoneyInput required value={f.amount_gbp} onChange={set("amount_gbp")} placeholder={eg.amount} style={{ ...inp, textAlign: "right" }} className="fos-num" /></Field>
        {/* The gross is the cash that leaves; the budget is charged the net.
            The basis is a choice on the form rather than an assumption. */}
        <Field label="VAT">
          <select value={f.vat_rate} onChange={set("vat_rate")} style={inp}>
            {VAT_TREATMENTS.map((t) => <option key={t.rate} value={String(t.rate)} title={t.hint}>{t.label}</option>)}
          </select>
        </Field>
        {/* The gross is worked out on the £ figure (a foreign order's spot
            conversion), so it is labelled in £ whatever the order currency. */}
        <Field label="Gross (£)">
          <input
            readOnly
            value={draftGross == null ? "" : draftGross.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            placeholder="—"
            title={vatRate ? `Net plus ${Number((vatRate * 100).toFixed(2))}% VAT — the cash that leaves; the budget is charged the net` : "No VAT — gross is the net amount"}
            style={{ ...inp, textAlign: "right", background: "var(--raise)", color: "var(--muted)" }} className="fos-num"
          />
        </Field>
        {isMiniso ? (
          <>
            <Field label="Pickup date"><input required type="date" value={f.pickup_date} onChange={set("pickup_date")} style={inp} /></Field>
            <Field label="Terms"><input value="180 days · from pickup" disabled style={{ ...inp, color: "var(--muted)" }} /></Field>
          </>
        ) : (
          <Field label="Terms (days)">
            <input type="number" min="0" value={f.terms_days} onChange={set("terms_days")} placeholder={eg.terms} style={{ ...inp, textAlign: "right" }} className="fos-num" />
          </Field>
        )}
        <Field label="Status"><select value={f.status} onChange={set("status")} style={inp}><option value="COMMITTED">Committed</option><option value="PAID">Paid</option></select></Field>
        <Field label="Reference (optional)"><input value={f.reference} onChange={set("reference")} placeholder={eg.ref} style={inp} /></Field>
      </div>
      {!isMiniso && split && (
        <div style={{ fontSize: 11.5, marginTop: 11, lineHeight: 1.55, color: split.over ? "var(--red)" : "var(--faint)" }}>
          {split.over ? (
            <>Terms of <strong>{split.supplierDays} days</strong> run past the {split.total}-day facility term. The
            supplier would be paid <strong>{split.supplierDays - split.total} days after</strong> we repay HSBC \u2014 check the terms.</>
          ) : (
            <>Local purchases settle on the <strong>{split.total}-day</strong> trade facility. The supplier is paid at{" "}
            <strong>{split.supplierDays} days</strong> from a drawdown; the facility carries the remaining{" "}
            <strong>{split.facilityDays} days</strong>. Our cash leaves at the {split.total}-day mark{draftYm ? <> \u2014 <strong>{monthLabel(draftYm)}</strong></> : null}, so the terms decide the drawdown, not the cash-out month.</>
          )}
        </div>
      )}
      {foreign && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 11, lineHeight: 1.5 }}>
          {spot == null
            ? <>No USD spot rate is set yet — add one on the <strong>Exchange rates</strong> tab before raising a USD order.</>
            : <>Provisionally ≈ <strong>{money(gbpPreview)}</strong> at the {money(1)}=${spot} spot rate. Finance re-strikes the GBP cost at the chosen rate on approval.</>}
        </div>
      )}
      {/* How the order's reference is decided — said on the form so nobody
          expects a second, system-made reference as well as their own. */}
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 11, lineHeight: 1.5 }}>
        <strong>Reference:</strong> if you enter one (e.g. the supplier&rsquo;s P.O number or the WC trade-pay reference), that becomes this order&rsquo;s reference everywhere — Procurement Summary, dashboards, alerts and emails — and no other is created. Leave it blank and the system gives the order one: <strong>PP-</strong> followed by its order number (e.g. PP-1042). Each order needs its own reference, and the PP- / MR- format is kept for the system.
      </div>
      {impact && <BudgetCheck impact={impact} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
        <button type="submit" className="fos-btn" disabled={busy} style={{ height: 34, fontSize: 12.5 }}>{busy ? "Adding…" : "Add purchase"}</button>
        {msg && <span style={{ fontSize: 12, color: msg === "Added." ? "var(--green)" : "var(--red)" }}>{msg}</span>}
      </div>
    </form>
  );
}

// Open to buy for the month this request is PAID in. Shown live as the form is
// filled so Merch see the position BEFORE submitting, rather than finding out at
// Finance review.
//
// "Open to buy" here is what is left to spend on a cash-out basis — budget minus
// what is already committed and already gone — for the month the money leaves.
// It is not the merchandising OTB model in the `merch` schema, which runs on
// selling periods and governs merch requests; this desk buys against the cash
// plan, and the cash plan is the constraint.
//
// It informs, it does not block — Finance still decides, and a genuinely needed
// purchase should still be raised.
function BudgetCheck({ impact }) {
  const { ym, budget, committed, spent, fx, add, newCommitted, headroom, headroomBefore, over, alreadyOver, noBudget } = impact;
  const tone = noBudget ? "var(--muted)" : over ? "var(--red)" : "var(--green)";
  const cell = { display: "flex", flexDirection: "column", gap: 2 };
  const k = { fontSize: 10.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--faint)" };
  const v = { fontSize: 13, fontWeight: 600 };
  return (
    <div style={{ marginTop: 13, padding: "11px 13px", borderRadius: 8, border: `1px solid ${noBudget ? "var(--line)" : over ? "var(--red)" : "var(--line)"}`, background: "var(--raise)" }}>
      <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 9, lineHeight: 1.5 }}>
        This is paid in <strong style={{ color: "var(--ink)" }}>{monthLabel(ym)}</strong> — whether that month is still open to buy.
        {!noBudget && <> Open to buy is budget &minus; committed &minus; spent + FX, so a month the facility has already drawn from shows what is genuinely left to spend.{fx ? <> FX is the {money(fx)} by which this month&rsquo;s commitment is held above the cash it will cost, stock being costed at one rate and settled at another.</> : null}</>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(104px,1fr))", gap: 12 }}>
        <div style={cell}><span style={k}>Budget</span><span style={v} className="fos-num">{noBudget ? "—" : money(budget)}</span></div>
        <div style={cell}><span style={k}>Committed</span><span style={v} className="fos-num">{money(committed)}</span></div>
        <div style={cell}><span style={k}>Spent</span><span style={v} className="fos-num">{spent ? money(spent) : "—"}</span></div>
        <div style={cell}>
          <span style={k}>Open to buy</span>
          <span style={{ ...v, color: noBudget ? undefined : headroomBefore < 0 ? "var(--red)" : "var(--green)" }} className="fos-num">
            {noBudget ? "—" : `${headroomBefore < 0 ? "−" : ""}${money(Math.abs(headroomBefore))}`}
          </span>
        </div>
        <div style={cell}><span style={k}>This request</span><span style={v} className="fos-num">{money(add)}</span></div>
        <div style={cell}>
          <span style={k}>{over ? "Over by" : "OTB after this"}</span>
          <span style={{ ...v, color: tone }} className="fos-num">{noBudget ? "—" : money(Math.abs(headroom))}</span>
        </div>
      </div>
      {noBudget && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 9 }}>No procurement budget is set for this month, so there is nothing open to buy against — Finance maintain these on the <strong>Budgets</strong> tab.</div>}
      {over && (
        <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 9, lineHeight: 1.5 }}>
          {alreadyOver
            ? <>{monthLabel(ym)} has nothing open to buy — it is already over on what is committed and spent, before this request. Expect Finance to challenge it.</>
            : <>This request is more than {monthLabel(ym)} has open to buy. You can still raise it — Finance will review it — but consider a pickup or order date that pays in a month with headroom.</>}
        </div>
      )}
    </div>
  );
}

// The raised orders with their approval lifecycle — raise → Head of Department
// sign-off → Finance → approved; cancel is the soft action, delete (Finance
// only, once head-approved) the hard one.
const hodApprovedStatus = (s) => s === "HOD_APPROVED" || s === "APPROVED";
function OrdersPanel({ orders, openOrder = null, amendments = {}, roles, canManage, fxRates = [], suppliers = [], onErr, onDone }) {
  // Which orders to list (REQUEST_VIEWS) — a linked order shows under All.
  const [view, setView] = useState("ALL");
  const [search, setSearch] = useState("");          // free-text search over the orders, as on P.O Requests
  const [supplierPick, setSupplierPick] = useState(""); // "" = every supplier
  useEffect(() => {
    if (openOrder == null) return;
    const t = setTimeout(() => document.getElementById(`order-${openOrder}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    return () => clearTimeout(t);
  }, [openOrder]);
  const [busy, setBusy] = useState(null);
  const [fxApprove, setFxApprove] = useState(null);   // purchase_id awaiting the FX rate picks
  const [edit, setEdit] = useState(null);             // { purchase_id, supplier, reference } being edited
  const [inv, setInv] = useState(null);               // { purchase_id, number, amount, vat } — the supplier's invoice being entered
  const { isHod, isFinance, isMerchApprover, me } = roles || {};
  // Whoever raised a Local order (or a manager) records the supplier's invoice
  // on it, to check it against what was ordered.
  const mayInvoice = (o) => !orderInvoiceError(o, { canManage, isRaiser: !!me && String(o.created_by || "").toLowerCase() === String(me).toLowerCase() });
  const vatErrOf = (x) => vatEntryError(x?.amount, x?.vat);
  async function saveInv() {
    if (!inv) return;
    const vat = String(inv.vat || "").replace(/[£,\s]/g, "");
    await act(inv.purchase_id, "set-invoice", { invoice_number: inv.number.trim(), invoice_amount: inv.amount, invoice_vat: vat === "" ? null : vat });
    setInv(null);
  }
  if (!orders.length) return null;

  async function act(id, action, extra) {
    onErr(""); setBusy(`${id}:${action}`);
    try { await post({ action, id, ...extra }); setFxApprove(null); onDone(); }
    catch (x) { onErr(x.message); }
    finally { setBusy(null); }
  }
  function openEdit(o) {
    setFxApprove(null);
    const day = (v) => (v ? String(v).slice(0, 10) : "");
    setEdit(edit?.purchase_id === o.purchase_id ? null : {
      purchase_id: o.purchase_id, source: o.source, currency: o.currency || "GBP", terms_days: o.terms_days,
      approval_status: o.approval_status, was: orderAmount(o), locked: orderEditError(o),
      supplier: o.supplier || "", reference: o.reference || "", category: o.category || "",
      amount: String(orderAmount(o) || ""), order_ym: o.order_ym || "", delivery_ym: o.delivery_ym || "",
      pickup_date: day(o.pickup_date), supplier_pay_date: day(o.supplier_pay_date),
    });
  }
  async function saveEdit() {
    if (!edit || !edit.supplier.trim()) return;
    const patch = {
      supplier: edit.supplier.trim(), reference: edit.reference, category: edit.category,
      amount: edit.amount, order_ym: edit.order_ym, delivery_ym: edit.delivery_ym,
      supplier_pay_date: edit.supplier_pay_date || null,
      ...(edit.source === "MINISO" ? { pickup_date: edit.pickup_date } : {}),
    };
    if (raisesApproved(edit) && !window.confirm("Raising the amount on an approved order sends it back to the head of department for approval. Continue?")) return;
    await act(edit.purchase_id, "edit", { patch });
    setEdit(null);
  }
  const raisesApproved = (e) => (e.approval_status === "HOD_APPROVED" || e.approval_status === "APPROVED") && Number(String(e.amount).replace(/,/g, "")) > (Number(e.was) || 0) + 0.005;
  // Suppliers to offer for this order's tab (Miniso vs everything else), falling
  // back to the full list; always keep the order's current name selectable.
  const editInp = { height: 30, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
  const cancel = (o) => { const reason = window.prompt("Cancel this order — reason (optional):", ""); if (reason === null) return; act(o.purchase_id, "cancel", { reason }); };
  const del = (o) => { if (window.confirm(`Delete this order (${o.supplier}) permanently? This cannot be undone.`)) act(o.purchase_id, "delete"); };
  // GBP orders approve in one click; a foreign order opens the rate pickers first.
  const financeApprove = (o) => (isForeignCurrency(o.currency) ? setFxApprove(fxApprove === o.purchase_id ? null : o.purchase_id) : act(o.purchase_id, "finance-approve"));
  const viewTest = (REQUEST_VIEWS.find((v) => v.key === view) || REQUEST_VIEWS[0]).test;
  const q = search.trim().toLowerCase();
  const matches = (o) => !q || [o.supplier, o.category, procRef(o), o.created_by, o.invoice_number, o.purchase_id, o.currency]
    .some((v) => String(v ?? "").toLowerCase().includes(q));
  // Suppliers with an order on this tab, A–Z, for the filter.
  const supplierNames = [...new Set(orders.map((o) => o.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const bySupplier = (o) => !supplierPick || o.supplier === supplierPick;
  const shown = orders.filter((o) => viewTest(o) && bySupplier(o) && matches(o));

  return (
    <Panel title="Orders" note="raise → head of department → finance · cancel any time; only finance can delete, once head-approved or cancelled">
      {(() => {
        // A challenge is Finance handing the order back. It is the one state on
        // this page where somebody is waiting on the team who raised it, so it
        // gets said once at the top rather than only inside a row.
        const ch = challengedOrders(orders);
        if (!ch.length) return null;
        return (
          <div style={{ border: "1px solid var(--red)", borderRadius: 9, padding: "10px 13px", marginBottom: 11, fontSize: 12.5, lineHeight: 1.55 }}>
            <strong style={{ color: "var(--red)" }}>
              {ch.length} order{ch.length === 1 ? "" : "s"} challenged by Finance
            </strong>{" "}
            — {ch.length === 1 ? "it is" : "they are"} marked below with the reason. Amend the order, or cancel it if it is no longer wanted. Finance re-review once it changes. An order not amended within 5 working days of the challenge is cancelled automatically.
          </div>
        );
      })()}
      {/* Status headers and search — the same as Purchase Order Requests. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 11 }}>
      <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, flexWrap: "wrap" }}>
        {REQUEST_VIEWS.map((v) => {
          const on = v.key === view;
          const n = orders.filter((o) => v.test(o) && bySupplier(o)).length;   // counts follow the supplier picked
          return (
            <button key={v.key} onClick={() => setView(v.key)} style={{
              fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
              background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
              color: on ? "var(--ink)" : "var(--muted)",
            }}>{v.label} <span style={{ color: "var(--faint)", fontWeight: 500 }}>{n}</span></button>
          );
        })}
      </div>
        <select value={supplierPick} onChange={(e) => setSupplierPick(e.target.value)} aria-label="Filter by supplier"
          style={{ height: 34, fontSize: 13, padding: "0 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: supplierPick ? "var(--ink)" : "var(--muted)", maxWidth: 240 }}>
          <option value="">All suppliers ({supplierNames.length})</option>
          {supplierNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders"
          placeholder="Search supplier, category, reference, raised by or invoice no…"
          style={{ height: 34, fontSize: 13, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", minWidth: 220, flex: 1 }} />
        {(search || supplierPick) && <button onClick={() => { setSearch(""); setSupplierPick(""); }} style={{ fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Clear</button>}
      </div>
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 980 }}>
          <thead><tr>
            {["Supplier", "Category", "Submitted by", "Order", "Supplier payment", "Miniso UK payment", "Amount", "Status"].map((h, i) => (
              <th key={i} title={i === 4 ? "Invoice date (order month-end) plus the supplier's terms, or the date set on the order" : i === 5 ? "180 days on the invoice / pickup date — drives the cash budget" : undefined} style={{ textAlign: i === 6 ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {!shown.length && (
              <tr><td colSpan={8} style={{ padding: "12px", fontSize: 12.5, color: "var(--faint)" }}>{q || supplierPick ? "No orders in this view match the supplier / search." : "No orders in this view."}</td></tr>
            )}
            {shown.map((o, i) => {
              const meta = PROC_STATUS_META[o.approval_status] || { label: o.approval_status, tone: "muted" };
              // Finance's own lifecycle. A challenge lands here, not on
              // approval_status, so without this the row reads "Approved" while
              // Finance are waiting on an answer.
              const chal = financeChallenge(o);
              const last = i === shown.length - 1 && fxApprove !== o.purchase_id;
              // The order's actions sit on a line of their own beneath it, so the
              // columns keep their width and no button is pushed off the edge.
              // The row line is drawn under that actions line.
              const rowEnd = last ? "none" : "1px solid var(--hairline)";
              const bb = "none";
              const cancelled = o.approval_status === "CANCELLED";
              const foreign = isForeignCurrency(o.currency);
              const approved = o.approval_status === "APPROVED";
              const btn = { fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" };
              return (
                <Fragment key={o.purchase_id}>
                <tr id={`order-${o.purchase_id}`} style={{ opacity: cancelled ? 0.55 : 1, background: String(openOrder) === String(o.purchase_id) ? "var(--accent-bg)" : undefined }}>
                  <td style={{ padding: "9px 12px", borderBottom: bb, fontWeight: 550, textDecoration: cancelled ? "line-through" : "none", maxWidth: 260, overflowWrap: "anywhere" }}>{o.supplier}<span style={{ color: "var(--faint)", fontWeight: 400 }} title={o.reference ? "The reference typed when it was raised" : "No reference was typed, so the system gave it one"}> · {procRef(o).split(/\s*[,;]\s*/).filter(Boolean).join(", ")}</span></td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, color: "var(--muted)" }}>{o.category || "—"}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, color: "var(--muted)", whiteSpace: "nowrap" }}>{submitterName(o.created_by)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}>{monthLabel(o.order_ym)}</td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap" }}>
                    {dmyOf(supplierDueDate(o))}
                    <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{o.supplier_pay_date ? "set on the order" : `${Number(o.terms_days) || 0} days terms`}</div>
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: bb, whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {dmyOf(ukPaymentDate(o))}
                    <div style={{ fontSize: 10.5, color: "var(--faint)" }}>cash budget {monthLabel(cashOutFor(o))}</div>
                  </td>
                  <td className="fos-num" style={{ padding: "9px 12px", textAlign: "right", borderBottom: bb, whiteSpace: "nowrap" }}>
                    {money(o.amount_gbp)}
                    {foreign && <div style={{ fontSize: 10.5, color: "var(--faint)", fontWeight: 400 }}>{ccyMoney(o.amount_ccy, o.currency)} {o.currency}{approved && o.cost_rate_type ? ` · ${FX_RATE_LABEL[o.cost_rate_type] || o.cost_rate_type}` : ""}</div>}
                  </td>
                  <td style={{ padding: "9px 12px", borderBottom: bb }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {chal && <Badge tone="red">Challenged</Badge>}
                      {/* Payment status — Finance mark it on Procurement Summary + Close. */}
                      {!cancelled && (orderPaid(o)
                        ? <Badge tone="green">Paid</Badge>
                        : o.payment_status === "PART_PAID" ? <Badge tone="amber">Part-paid</Badge> : <Badge tone="accent">Unpaid</Badge>)}
                    </div>
                    {!cancelled && orderPaid(o) && (o.payment_method || o.paid_date) && (
                      <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 3 }}>
                        Paid{o.payment_method ? ` · ${o.payment_method === "TRADE_PAY" ? "trade pay" : "cash"}` : ""}{o.paid_date ? ` · ${dmyOf(o.paid_date)}` : ""}
                      </div>
                    )}
                    {o.source === "LOCAL" && Number(o.invoice_amount) > 0 && (() => {
                      const m = invoiceMatch(o.amount_gbp, o.invoice_amount);
                      const col = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" }[m.tone] || "var(--muted)";
                      const nv = netVat(o.invoice_amount, o.invoice_vat);
                      return <div style={{ fontSize: 10.5, color: col, marginTop: 4, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.4 }}>Invoice {o.invoice_number || ""} {money(nv.net)} net{nv.vat != null ? ` + ${money(nv.vat)} VAT = ${money(nv.gross)}` : ""} · {m.label.replace("P.O", "order")}</div>;
                    })()}
                    {chal && (
                      <div style={{ marginTop: 5, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.45 }}>
                        <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 600 }}>
                          {challengeReasonLabels(chal.reasons).join(" · ") || "Queried by Finance"}
                        </div>
                        {chal.note && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>&ldquo;{chal.note}&rdquo;</div>}
                        <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
                          Finance are waiting on you — amend it, or cancel it.
                          {(() => { const n = lapseNote(challengeLapse(o, new Date(), "PROCUREMENT", undefined, { amendedAt: amendments[String(o.purchase_id)] })); return n ? ` ${n}.` : ""; })()}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
                <tr style={{ opacity: cancelled ? 0.55 : 1, background: String(openOrder) === String(o.purchase_id) ? "var(--accent-bg)" : undefined }}>
                  <td colSpan={8} style={{ padding: "0 12px 9px", borderBottom: rowEnd }}>
                    {cancelled ? (
                      <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--faint)" }}>{o.cancel_reason ? `“${o.cancel_reason}”` : "—"}</span>
                        {/* A cancelled order commits nothing — Finance can clear it off the list. */}
                        {isFinance && <button disabled={busy} style={{ ...btn, borderColor: "var(--red)", color: "var(--red)", opacity: 1 }} onClick={() => del(o)}>Delete</button>}
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {(isHod || isMerchApprover) && o.approval_status === "PENDING" && <button disabled={busy} style={{ ...btn, borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => act(o.purchase_id, "hod-approve")}>Approve (Head)</button>}
                        {canManage && o.approval_status === "PENDING" && <button disabled={busy} style={btn} title="Re-send the head-of-department sign-off request" onClick={() => act(o.purchase_id, "resubmit")}>Resubmit</button>}
                        {isFinance && (o.approval_status === "PENDING" || o.approval_status === "HOD_APPROVED") && <button disabled={busy} style={{ ...btn, borderColor: "var(--green)", color: "var(--green)" }} onClick={() => financeApprove(o)}>{foreign ? "Approve (Finance)…" : "Approve (Finance)"}</button>}
                        {mayInvoice(o) && <button disabled={busy} style={inv?.purchase_id === o.purchase_id ? { ...btn, borderColor: "var(--accent)", color: "var(--accent)" } : btn}
                          onClick={() => setInv(inv?.purchase_id === o.purchase_id ? null : { purchase_id: o.purchase_id, number: o.invoice_number || "", amount: o.invoice_amount != null ? String(o.invoice_amount) : "", vat: o.invoice_vat != null ? String(o.invoice_vat) : "" })}>{o.invoice_number ? "Invoice" : "Add invoice"}</button>}
                        {canManage && <button disabled={busy} style={btn} onClick={() => openEdit(o)}>Edit</button>}
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
                {inv?.purchase_id === o.purchase_id && (
                  <tr>
                    <td colSpan={8} style={{ padding: "12px 14px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <label style={{ display: "block" }}><span style={FIELD_LAB}>Invoice no / ref</span>
                          <input style={{ ...editInp, width: 170 }} value={inv.number} onChange={(e) => setInv((s) => ({ ...s, number: e.target.value }))} placeholder="e.g. INV-1042" />
                        </label>
                        <label style={{ display: "block" }}><span style={FIELD_LAB}>Invoice value (net)</span>
                          <input style={{ ...editInp, width: 140, textAlign: "right" }} inputMode="decimal" value={inv.amount} onChange={(e) => setInv((s) => ({ ...s, amount: e.target.value }))} placeholder="0.00" />
                        </label>
                        <label style={{ display: "block" }}><span style={FIELD_LAB}>VAT</span>
                          <input style={{ ...editInp, width: 110, textAlign: "right" }} inputMode="decimal" value={inv.vat || ""} onChange={(e) => setInv((s) => ({ ...s, vat: e.target.value }))} placeholder="0.00" />
                        </label>
                        {(() => {
                          const vErr = vatEntryError(inv.amount, inv.vat);
                          if (vErr) return <span style={{ fontSize: 12, color: "var(--red)", alignSelf: "center", maxWidth: 320 }}>{vErr}</span>;
                          const nv = netVat(inv.amount, inv.vat);
                          const m = invoiceMatch(o.amount_gbp, nv.net);
                          const col = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" }[m.tone] || "var(--muted)";
                          return <span style={{ fontSize: 12, color: col, alignSelf: "center" }}>Order {money(o.amount_gbp)} net · {m.label.replace("P.O", "order")}{nv.net > 0 ? <span style={{ color: "var(--faint)" }}> · gross {money(nv.gross)}</span> : null}</span>;
                        })()}
                        <button disabled={busy || !!vatErrOf(inv)} onClick={saveInv} style={{ fontSize: 12.5, fontWeight: 650, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>Save invoice</button>
                        <button disabled={busy} onClick={() => setInv(null)} style={{ fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Cancel</button>
                        <span style={{ fontSize: 11, color: "var(--faint)", flex: "1 1 200px" }}>Net and VAT as on the invoice — the net is checked against the order and the budget, both ex-VAT. Clear the fields to remove it. Finance record and close it on Procurement Summary + Close.</span>
                      </div>
                    </td>
                  </tr>
                )}
                {edit?.purchase_id === o.purchase_id && (
                  <tr>
                    <td colSpan={8} style={{ padding: "12px 14px", borderBottom: i === orders.length - 1 ? "none" : "1px solid var(--hairline)", background: "var(--raise)" }}>
                      {edit.locked ? (
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{edit.locked}.</span>
                          <button disabled={busy} onClick={() => setEdit(null)} style={{ fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Close</button>
                        </div>
                      ) : (() => {
                        const setE = (k) => (e) => setEdit((s) => ({ ...s, [k]: e.target.value }));
                        const draft = { source: edit.source, order_ym: edit.order_ym, pickup_date: edit.pickup_date, terms_days: edit.terms_days };
                        const termsDate = supplierTermsDate(draft);
                        const uk = ukPaymentDate(draft);
                        const sym = CCY_SYMBOL[edit.currency] || edit.currency;
                        return (
                          <>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Supplier</span>
                                <select style={{ ...editInp, width: 220 }} value={edit.supplier} onChange={setE("supplier")}>
                                  {!suppliers.some((sp) => sp.name === edit.supplier) && edit.supplier && <option value={edit.supplier}>{edit.supplier} (current)</option>}
                                  {suppliers.map((sp) => <option key={sp.name} value={sp.name}>{sp.name}</option>)}
                                </select>
                              </label>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Reference</span>
                                <input style={{ ...editInp, width: 140 }} value={edit.reference} onChange={setE("reference")} placeholder={`blank = PP-${edit.purchase_id}`} />
                              </label>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Category</span>
                                <input style={{ ...editInp, width: 140 }} value={edit.category} onChange={setE("category")} />
                              </label>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Net amount ({sym})</span>
                                <MoneyInput style={{ ...editInp, width: 130, textAlign: "right" }} className="fos-num" value={edit.amount} onChange={setE("amount")} />
                              </label>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Order month</span>
                                <input type="month" style={{ ...editInp, width: 150 }} value={edit.order_ym} onChange={setE("order_ym")} />
                              </label>
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Delivery month</span>
                                <input type="month" style={{ ...editInp, width: 150 }} value={edit.delivery_ym} onChange={setE("delivery_ym")} />
                              </label>
                              {edit.source === "MINISO" && (
                                <label style={{ display: "block" }}><span style={FIELD_LAB}>Pickup date</span>
                                  <input type="date" style={{ ...editInp, width: 150 }} value={edit.pickup_date} onChange={setE("pickup_date")} />
                                </label>
                              )}
                              <label style={{ display: "block" }}><span style={FIELD_LAB}>Supplier payment date</span>
                                <input type="date" style={{ ...editInp, width: 150 }} value={edit.supplier_pay_date} onChange={setE("supplier_pay_date")} />
                              </label>
                              <div style={{ display: "block" }}><span style={FIELD_LAB}>Miniso UK payment date</span>
                                <div style={{ ...editInp, width: 150, display: "flex", alignItems: "center", background: "var(--raise)", color: "var(--muted)" }} title="180 days on the invoice / pickup date — drives the cash budget, so it can't be edited">{dmyOf(uk)} 🔒</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                              <button disabled={busy || !edit.supplier.trim() || !(Number(String(edit.amount).replace(/,/g, "")) > 0)} onClick={saveEdit} style={{ fontSize: 12.5, fontWeight: 650, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>Save</button>
                              <button disabled={busy} onClick={() => setEdit(null)} style={{ fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>Cancel</button>
                              <span style={{ fontSize: 11, color: raisesApproved(edit) ? "var(--amber)" : "var(--faint)", flex: "1 1 300px", lineHeight: 1.5 }}>
                                {raisesApproved(edit) ? "Raising the amount sends this approved order back to the head of department for approval. " : ""}
                                Supplier payment date: leave blank for the invoice date (order month-end) plus {Number(edit.terms_days) || 0} days terms{termsDate ? ` — ${dmyOf(termsDate)}` : ""}. The Miniso UK payment date is 180 days on the {edit.source === "MINISO" ? "pickup" : "invoice"} date and drives the cash budget, so it moves only with the order&rsquo;s dates.
                              </span>
                            </div>
                          </>
                        );
                      })()}
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
function Panel({ title, note, right, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 14.5, fontWeight: 650 }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: "var(--faint)", flex: 1 }}>· {note}</span>}
        {right && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}
/*
 * Each supplier's trade terms: what we still owe them on live orders, when it
 * falls due, and how much of the credit limit is left — so whoever raises an
 * order can see the room they have and when it frees up. Paid orders (cash or
 * trade pay) owe nothing. Rules in supplier-terms-rules.js.
 */
function SupplierTerms({ orders = [], suppliers = [] }) {
  const rows = useMemo(() => supplierTermsPosition(orders, suppliers, new Date()), [orders, suppliers]);
  const [showAll, setShowAll] = useState(false);
  const open = rows.filter((r) => r.open > 0);
  const shown = showAll ? rows : open;
  const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const dash = <span style={{ color: "var(--faint)" }}>—</span>;
  const sub = (t, tone) => <div style={{ fontSize: 10.5, color: tone || "var(--faint)", marginTop: 2, fontWeight: 400 }}>{t}</div>;
  const total = (k) => open.reduce((t, r) => t + (r[k] || 0), 0);
  return (
    <Panel title="Suppliers · trade terms"
      note="committed = what we still owe on live orders (paid in cash or on trade pay drops off) · available = credit limit less committed · aged by days past the due date (order month-end + terms) · net of VAT"
      right={rows.length > open.length ? (
        <button className="fos-btn-ghost" type="button" onClick={() => setShowAll((x) => !x)}>
          {showAll ? "Open balances only" : `All suppliers (${rows.length})`}
        </button>
      ) : null}>
      {!shown.length ? <Empty>{rows.length ? "Nothing owed to any supplier on this tab." : "No suppliers yet."}</Empty> : (
        <Table head={["Supplier", "Terms", "Credit limit", "Committed", "Available", "Due now", "Current", "1–30 days", "31–60 days", "60+ days", "Next due"]} align={[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]}>
          {shown.map((r) => {
            const aged = (v, tone) => (v > 0 ? <Td r tone={tone}>{money(v)}</Td> : <Td r>{dash}</Td>);
            return (
              <tr key={r.supplier}>
                <Td>{r.supplier}{r.oldestDays != null && r.open > 0 && sub(`oldest ${r.oldestDays} days outstanding`, r.overdue > 0 ? "var(--red)" : undefined)}</Td>
                <Td r>{r.terms_days} days</Td>
                <Td r>{r.limit == null ? <span style={{ color: "var(--faint)" }} title="Set a credit limit on the Supplier master">not set</span> : money(r.limit)}</Td>
                <Td r>
                  {r.open > 0 ? money(r.open) : dash}
                  {r.open > 0 && sub(`${r.openOrders} order${r.openOrders === 1 ? "" : "s"}${r.awaiting > 0 ? ` · ${money(r.awaiting)} awaiting approval` : ""}`)}
                </Td>
                <Td r tone={r.available == null ? undefined : r.over ? "var(--red)" : r.near ? "var(--amber)" : "var(--green)"}>
                  {r.available == null ? dash : <>{money(r.available)}{r.utilisation != null && sub(`${Math.round(r.utilisation * 100)}% used${r.over ? " · over limit" : ""}`, r.over ? "var(--red)" : undefined)}</>}
                </Td>
                {aged(r.dueNow, "var(--red)")}
                {aged(r.current)}
                {aged(r.od30, "var(--amber)")}
                {aged(r.od60, "var(--red)")}
                {aged(r.od60plus, "var(--red)")}
                <Td r>{r.nextDue ? <>{dmy(r.nextDue.date)}{sub(`${money(r.nextDue.amount)} frees up`)}</> : dash}</Td>
              </tr>
            );
          })}
          {open.length > 1 && (
            <tr>
              <Td><strong>Total</strong></Td>
              <Td r /><Td r />
              <Td r><strong>{money(total("open"))}</strong></Td>
              <Td r />
              {["dueNow", "current", "od30", "od60", "od60plus"].map((k) => <Td key={k} r><strong>{total(k) > 0 ? money(total(k)) : "—"}</strong></Td>)}
              <Td r />
            </tr>
          )}
        </Table>
      )}
    </Panel>
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
function MerchRequests({ otbVersions = [], activeVersionId = null, requests = [], channelOpts = [], canManage, isMerchApprover = false, suppliers = [] }) {
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
            <Field label="Supplier">
              <SupplierPicker options={suppliers} value={f.supplier} onChange={(name) => setF((s) => ({ ...s, supplier: name }))} selectStyle={inp} />
            </Field>
            <Field label="Category"><input style={inp} value={f.category} onChange={set("category")} placeholder="e.g. Core range" /></Field>
            <Field label="Amount (£)"><MoneyInput style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.amount_gbp} onChange={set("amount_gbp")} placeholder="e.g. 250000" /></Field>
            <Field label="OTB period"><input placeholder="YYYY-MM" style={inp} value={f.otb_period} onChange={set("otb_period")} /></Field>
            <Field label="Units"><input type="number" style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.units} onChange={set("units")} /></Field>
            <Field label="Freight (£)"><MoneyInput style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.freight} onChange={set("freight")} /></Field>
            <Field label="Duty (£)"><MoneyInput style={{ ...inp, textAlign: "right" }} className="fos-num" value={f.duty} onChange={set("duty")} /></Field>
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
                // The MERCH_REVIEW sign-off is the head of department's (Becky);
                // every other stage is Finance/Ops. Only show the buttons the
                // viewer can actually run so no one clicks into a 403.
                const canActHere = r.request_status === "MERCH_REVIEW" ? isMerchApprover : canManage;
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
                        {canActHere && acts.map(([action, label]) => (
                          <button key={action} style={action === "reject" ? { ...ghost, color: "var(--red)" } : ghost} disabled={busy} onClick={() => reqOp(r.purchase_id, { op: "transition", action })}>{label}</button>
                        ))}
                        {canManage && r.validation_status === "EXCEEDS_OTB" && (
                          <button style={{ ...ghost, color: "var(--amber)" }} disabled={busy} onClick={() => { const reason = window.prompt("Reason for the OTB exception?"); if (reason) reqOp(r.purchase_id, { op: "exception", reason }); }}>Record exception</button>
                        )}
                        {canManage && r.request_status === "APPROVED" && (
                          <button style={btn("var(--green)")} disabled={busy} onClick={() => reqOp(r.purchase_id, { op: "generate-po" })}>Generate P.O</button>
                        )}
                        {!canActHere && !acts.length && <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>}
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
