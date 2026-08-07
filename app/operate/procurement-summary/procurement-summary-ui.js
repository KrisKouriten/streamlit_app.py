"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  displayStatus, PROC_CHALLENGE_REASONS, challengeReasonLabels, PROC_PAYMENT_STATUSES,
  paymentStatusOf, committedAmount, lineValue, procRef, isMerchRequest, financeActionError,
  settlesByLc, lcStatus, lcActionError, LC_BANK_DEFAULT,
  isForeignRow, stockValue, fxToPL,
} from "../../../lib/procurement-close-rules";
import { money, StatRow, Stat, Badge } from "../../finance-os/ui";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
// Original foreign-currency amount, e.g. "$12,700 USD".
const CCY_SYMBOL = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
const ccyAmt = (v, ccy) => `${CCY_SYMBOL[ccy] || ""}${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy || ""}`.trim();
// Render any date value safely — never a raw Date object (React can't render one).
// Accepts a 'YYYY-MM-DD' string or a Date; shows UK-style DD/MM/YYYY.
const fmtDate = (v) => {
  if (!v) return "—";
  const s = typeof v === "string" ? v : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
// LCs against a Miniso order are denominated in that order's currency (USD), so
// the LC amounts and the logged-vs-order comparison stay in the order currency
// rather than being mislabelled/compared as GBP.
const curSym = (r) => CCY_SYMBOL[(r && r.currency) || "GBP"] || "£";
const curMoney = (v, r) => {
  const c = (r && r.currency) || "GBP";
  return c !== "GBP" ? `${CCY_SYMBOL[c] || ""}${Math.round(Number(v) || 0).toLocaleString("en-GB")}` : money(v);
};
// The order's own-currency total the LCs should sum to (USD amount for a foreign
// order, else the GBP value).
const orderCurTotal = (r) => (isForeignRow(r) && r.amount_ccy != null ? Number(r.amount_ccy) : Number(r.amount_gbp));
const inputSt = { fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const TONE_FG = { muted: "var(--muted)", red: "var(--red)", amber: "var(--amber)", green: "var(--green)", accent: "var(--accent)" };

const FILTERS = [
  { key: "ATTENTION", label: "Needs Finance", test: (r) => r.finance_status !== "CLOSED" },
  { key: "PENDING", label: "Pending", test: (r) => r.finance_status === "PENDING" },
  { key: "APPROVED", label: "Approved", test: (r) => r.finance_status === "APPROVED" },
  { key: "CHALLENGED", label: "Challenged", test: (r) => r.finance_status === "CHALLENGED" },
  { key: "CLOSED", label: "Closed", test: (r) => r.finance_status === "CLOSED" },
  { key: "ALL", label: "All", test: () => true },
];

const channelCategory = (r) => (r.channel_code ? `${r.channel_code}${r.sku_or_range ? " · " + r.sku_or_range : ""}` : (r.category || "—"));
// LC facility stage: Import loan while goods are in transit, Trade loan once
// they arrive in Miniso UK's possession.
const LOAN_META = { IMPORT: { label: "Import loan", tone: "amber" }, TRADE: { label: "Trade loan", tone: "green" } };

export default function ProcurementSummaryUI({ initialRows = [] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ATTENTION");
  const [source, setSource] = useState("");
  const [inv, setInv] = useState(() => {
    const m = {};
    for (const r of initialRows) m[r.purchase_id] = { number: r.invoice_number || "", amount: r.invoice_amount != null ? String(r.invoice_amount) : "" };
    return m;
  });
  const [challengeFor, setChallengeFor] = useState(null);
  const [chReasons, setChReasons] = useState(() => new Set());
  const [chNote, setChNote] = useState("");
  const [lcFor, setLcFor] = useState(null);
  const [reconLc, setReconLc] = useState(null); // { lc_id, lc_settled_date, lc_settled_amount }
  const [editLc, setEditLc] = useState(null);   // { lc_id, ...editable LC fields }
  const [lcForm, setLcForm] = useState(() => {
    const m = {};
    // The "Add LC" form starts blank; the bank defaults to the request's bank.
    for (const r of initialRows) m[r.purchase_id] = {
      dc_reference: "", lc_reference: "", lc_amount: "", lc_bank: r.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: "", lc_payment_date: "",
    };
    return m;
  });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(null);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[FILTERS.length - 1];
    return initialRows.filter((r) => f.test(r) && (!source || r.source === source));
  }, [initialRows, filter, source]);

  const counts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.key] = initialRows.filter((r) => f.test(r)).length;
    return c;
  }, [initialRows]);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, challenged = 0, closed = 0, committed = 0;
    for (const r of initialRows) {
      if (r.finance_status === "PENDING") pending++;
      else if (r.finance_status === "APPROVED") approved++;
      else if (r.finance_status === "CHALLENGED") challenged++;
      else if (r.finance_status === "CLOSED") { closed++; committed += committedAmount(r); }
    }
    return { pending, approved, challenged, closed, committed };
  }, [initialRows]);

  const setInvField = (id, k, v) => setInv((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  async function op(id, body, successMsg) {
    setBusy(id); setError(null); setMessage(null);
    try {
      const res = await fetch("/api/procurement/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Action failed"); return; }
      setMessage(successMsg);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const saveInvoice = (r) => op(r.purchase_id, { op: "set-invoice", invoice_number: inv[r.purchase_id]?.number || null, invoice_amount: inv[r.purchase_id]?.amount || null }, "Invoice saved.");
  const setPayment = (r, payment_status) => op(r.purchase_id, { op: "set-payment-status", payment_status }, `Marked ${paymentStatusOf({ payment_status }).label.toLowerCase()}.`);
  const closeRow = (r) => {
    if (!window.confirm(`Close ${procRef(r)}? It will be reported as committed procurement spend.`)) return;
    op(r.purchase_id, { op: "close", invoice_number: inv[r.purchase_id]?.number || null, invoice_amount: inv[r.purchase_id]?.amount || null }, "Closed — now committed spend.");
  };
  const approve = (r) => op(r.purchase_id, { op: "approve" }, "Approved.");
  const reopen = (r) => op(r.purchase_id, { op: "reopen-finance" }, "Re-opened.");

  function openChallenge(r) {
    setChallengeFor(r.purchase_id);
    const existing = challengeReasonLabels(r.challenge_reasons);
    const codes = PROC_CHALLENGE_REASONS.filter((x) => existing.includes(x.label)).map((x) => x.code);
    setChReasons(new Set(codes));
    setChNote(r.challenge_note || "");
  }
  function toggleReason(code, on) {
    setChReasons((cur) => { const n = new Set(cur); if (on) n.add(code); else n.delete(code); return n; });
  }
  async function submitChallenge(r) {
    await op(r.purchase_id, { op: "challenge", reasons: [...chReasons], note: chNote || null }, "Challenge raised.");
    setChallengeFor(null); setChReasons(new Set()); setChNote("");
  }

  const setLcField = (id, k, v) => setLcForm((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  function openLc(r) { setLcFor((cur) => (cur === r.purchase_id ? null : r.purchase_id)); }
  // Add one LC to the request — multiple are allowed against a Miniso request.
  async function addLcRow(r) {
    const f = lcForm[r.purchase_id] || {};
    await op(r.purchase_id, {
      op: "add-lc", dc_reference: f.dc_reference || null, lc_reference: f.lc_reference || null, lc_amount: f.lc_amount || null,
      lc_bank: f.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: f.lc_confirmed_date || null, lc_payment_date: f.lc_payment_date || null,
    }, "LC logged.");
    // clear the add form for the next one
    setLcForm((s) => ({ ...s, [r.purchase_id]: { ...s[r.purchase_id], dc_reference: "", lc_reference: "", lc_amount: "", lc_confirmed_date: "", lc_payment_date: "" } }));
  }
  async function reconcileEntry(r) {
    if (!reconLc) return;
    await op(r.purchase_id, { op: "reconcile-lc-entry", lc_id: reconLc.lc_id, lc_settled_date: reconLc.lc_settled_date || null, lc_settled_amount: reconLc.lc_settled_amount || null }, "LC reconciled — settled.");
    setReconLc(null);
  }
  async function deleteLcRow(r, lc) {
    if (!window.confirm(`Delete LC ${lc.lc_reference}? This cannot be undone.`)) return;
    await op(r.purchase_id, { op: "delete-lc", lc_id: lc.lc_id }, "LC removed.");
  }
  function openEditLc(lc) {
    setReconLc(null);
    setEditLc(editLc?.lc_id === lc.lc_id ? null : {
      lc_id: lc.lc_id, dc_reference: lc.dc_reference || "", lc_reference: lc.lc_reference || "", lc_amount: lc.lc_amount != null ? String(lc.lc_amount) : "",
      lc_bank: lc.lc_bank || LC_BANK_DEFAULT, lc_confirmed_date: lc.lc_confirmed_date || "", lc_payment_date: lc.lc_payment_date || "",
      actual_payment_date: lc.actual_payment_date || "", loan_type: lc.loan_type || "IMPORT", goods_arrived_date: lc.goods_arrived_date || "",
    });
  }
  const editField = (k, v) => setEditLc((s) => ({ ...s, [k]: v }));
  async function saveEditLc(r) {
    const f = editLc;
    await op(r.purchase_id, {
      op: "update-lc", lc_id: f.lc_id, dc_reference: f.dc_reference, lc_reference: f.lc_reference, lc_amount: f.lc_amount || null,
      lc_bank: f.lc_bank, lc_confirmed_date: f.lc_confirmed_date || null, lc_payment_date: f.lc_payment_date || null,
      actual_payment_date: f.actual_payment_date || null, loan_type: f.loan_type, goods_arrived_date: f.goods_arrived_date || null,
    }, "LC updated.");
    setEditLc(null);
  }

  function download() {
    const head = ["Reference", "Source", "Supplier", "Channel / Category", "Net value", "Currency", "Amount (ccy)", "Cost rate", "Inventory (costing)", "Stock rate", "FX to P&L", "Finance status", "Payment status", "Invoice no", "Invoice net"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of rows) {
      const sv = stockValue(r), v = fxToPL(r);
      lines.push([
        procRef(r), r.source, r.supplier, channelCategory(r), lineValue(r),
        r.currency || "GBP", isForeignRow(r) && r.amount_ccy != null ? r.amount_ccy : "", r.cost_rate_type || "",
        sv != null ? sv : "", r.stock_rate_type || "", v != null ? v : "",
        r.finance_status, r.payment_status, r.invoice_number || "", r.invoice_amount != null ? r.invoice_amount : "",
      ].map(esc).join(","));
    }
    const csv = lines.join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `procurement-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div>
      {/* ---- Stats ---- */}
      <StatRow>
        <Stat label="Pending approval" value={stats.pending} />
        <Stat label="Approved / open" value={stats.approved} />
        <Stat label="Under challenge" value={stats.challenged} tone={stats.challenged > 0 ? "red" : undefined} />
        <Stat label="Closed" value={stats.closed} />
        <Stat label="Committed £" value={money(stats.committed, { compact: true })} />
      </StatRow>

      {/* ---- Messages ---- */}
      {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ color: "var(--green)", fontSize: 12.5, marginBottom: 12 }}>{message}</div>}

      {/* ---- Controls ---- */}
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                fontSize: 12.5, fontWeight: on ? 650 : 500, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                background: on ? "var(--surface)" : "transparent", border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
                color: on ? "var(--ink)" : "var(--muted)",
              }}>{f.label} <span style={{ color: "var(--faint)", fontWeight: 500 }}>{counts[f.key]}</span></button>
            );
          })}
        </div>
        <select style={inputSt} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="MINISO">Miniso</option>
          <option value="LOCAL">Local</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{rows.length} row{rows.length === 1 ? "" : "s"}</span>
          <button style={ghost} disabled={rows.length === 0} onClick={download}>Download (CSV)</button>
        </div>
      </div>

      {/* ---- Table ---- */}
      <div style={card}>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No procurement purchases in this view.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1320 }}>
              <thead><tr>
                {["Reference", "Source", "Type", "Supplier", "Channel / Category", "Net", "Inventory (costing)", "Invoice no", "Invoice net", "Status", "Payment", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const id = r.purchase_id;
                  const st = displayStatus(r);
                  const pay = paymentStatusOf(r);
                  const isBusy = busy === id;
                  const fs = r.finance_status;
                  return (
                    <FragmentRow key={id}>
                      <tr>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>{procRef(r)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.source}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{isMerchRequest(r) ? "Merch request" : "Cash purchase"}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.supplier}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{channelCategory(r)}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {money(lineValue(r))}
                          {isForeignRow(r) && r.amount_ccy != null && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>{ccyAmt(r.amount_ccy, r.currency)}{r.cost_rate_type ? ` @ ${r.cost_rate_type.toLowerCase()}` : ""}</div>}
                          {fs === "CLOSED" && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>Committed {money(committedAmount(r))}</div>}
                        </td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>
                          {(() => {
                            const sv = stockValue(r);
                            if (sv == null) return <span style={{ color: "var(--faint)" }}>—</span>;
                            const v = fxToPL(r);
                            return (
                              <>
                                {money(sv)}
                                <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>at {(r.stock_rate_type || "costing").toLowerCase()} rate</div>
                                {v != null && <div style={{ fontSize: 10.5, marginTop: 2, color: v >= 0 ? "var(--green)" : "var(--red)" }}>FX to P&amp;L {v >= 0 ? "+" : ""}{money(v)}</div>}
                              </>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.invoice_number || "—"}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>{r.invoice_amount != null ? money(r.invoice_amount) : "—"}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {fs === "CHALLENGED" && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 190, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeReasonLabels(r.challenge_reasons).join(" · ")}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          {settlesByLc(r) ? (() => { const lc = lcStatus(r); return <Badge tone={lc.tone}>{lc.label}</Badge>; })() : <Badge tone={pay.tone}>{pay.label}</Badge>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {fs === "PENDING" && financeActionError("approve", r) === null && (
                              <button style={btn("var(--green)")} disabled={isBusy} onClick={() => approve(r)}>Approve</button>
                            )}
                            {fs === "APPROVED" && settlesByLc(r) && (
                              <button style={btn("var(--accent)")} disabled={isBusy} onClick={() => openLc(r)}>{r.lc_reference ? "Manage LC" : "Log LC"}</button>
                            )}
                            {fs === "APPROVED" && !settlesByLc(r) && (
                              <>
                                <input style={{ ...inputSt, width: 110 }} placeholder="Invoice no" value={inv[id]?.number || ""} onChange={(e) => setInvField(id, "number", e.target.value)} />
                                <input type="number" min="0" step="0.01" style={{ ...inputSt, width: 100, textAlign: "right" }} placeholder="Invoice net" value={inv[id]?.amount || ""} onChange={(e) => setInvField(id, "amount", e.target.value)} />
                                {financeActionError("invoice", r) === null && <button style={ghost} disabled={isBusy} onClick={() => saveInvoice(r)}>Save invoice</button>}
                                {financeActionError("payment", r) === null && (
                                  <select style={{ ...inputSt, width: 110, color: TONE_FG[pay.tone] }} value={pay.code} disabled={isBusy} onChange={(e) => setPayment(r, e.target.value)}>
                                    {PROC_PAYMENT_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                                  </select>
                                )}
                              </>
                            )}
                            {fs === "CHALLENGED" && settlesByLc(r) && (
                              <button style={btn("var(--accent)")} disabled={isBusy} onClick={() => openLc(r)}>{r.lc_reference ? "Manage LC" : "Log LC"}</button>
                            )}
                            {(fs === "CHALLENGED") && financeActionError("reopen", r) === null && <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>}
                            {financeActionError("close", r) === null && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closeRow(r)}>Close</button>}
                            {financeActionError("challenge", r) === null && <button style={btn("var(--red)")} disabled={isBusy} onClick={() => openChallenge(r)}>Challenge</button>}
                            {fs === "CLOSED" && financeActionError("reopen", r) === null && (
                              <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {lcFor === id && settlesByLc(r) && (
                        <tr>
                          <td colSpan={12} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            {(() => {
                              const lcs = r.lcs || [];
                              const totalLogged = lcs.reduce((s, l) => s + (Number(l.lc_amount) || 0), 0);
                              return (
                              <>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                              <span style={{ fontSize: 13, fontWeight: 650 }}>Letters of Credit — {procRef(r)}</span>
                              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {lcs.length} LC{lcs.length === 1 ? "" : "s"} · {curMoney(totalLogged, r)} logged of {curMoney(orderCurTotal(r), r)}{totalLogged > orderCurTotal(r) + 0.5 ? " — over order net" : ""}{isForeignRow(r) ? ` ${r.currency}` : ""}</span>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--faint)", marginBottom: 12, lineHeight: 1.5 }}>
                              Miniso HQ inventory settles by {r.lc_bank || LC_BANK_DEFAULT} LC — one request can be split across several LC applications. Log each LC, then reconcile it once it settles. The request is marked paid once every LC has settled.
                            </div>

                            {/* Logged LCs */}
                            {lcs.length > 0 && (
                              <div className="fos-tbl" style={{ overflowX: "auto", marginBottom: 14 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                                  <thead><tr>{["DC reference", "LC reference", "Amount", "Bank", "Loan", "Expected", "Actual paid", "Status", ""].map((h, i) => (
                                    <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "6px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
                                  <tbody>
                                    {lcs.map((l) => {
                                      const loan = LOAN_META[l.loan_type] || LOAN_META.IMPORT;
                                      return (
                                      <Fragment key={l.lc_id}>
                                        <tr>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)" }}>{l.dc_reference || "—"}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", fontWeight: 550 }}>{l.lc_reference}</td>
                                          <td className="fos-num" style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>{l.lc_amount != null ? curMoney(l.lc_amount, r) : "—"}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", color: "var(--muted)" }}>{l.lc_bank || "—"}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}><Badge tone={loan.tone}>{loan.label}</Badge></td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>{fmtDate(l.lc_payment_date)}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap", color: l.actual_payment_date ? "var(--ink)" : "var(--faint)" }}>{fmtDate(l.actual_payment_date)}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>{l.lc_settled ? <Badge tone="green">Settled {l.lc_settled_date ? fmtDate(l.lc_settled_date) : ""}</Badge> : <Badge tone="amber">Pending</Badge>}</td>
                                          <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", whiteSpace: "nowrap" }}>
                                            <button style={{ ...ghost, marginRight: 6 }} disabled={isBusy} onClick={() => openEditLc(l)}>Edit</button>
                                            {!l.lc_settled && <button style={{ ...ghost, marginRight: 6 }} disabled={isBusy} onClick={() => { setEditLc(null); setReconLc(reconLc?.lc_id === l.lc_id ? null : { lc_id: l.lc_id, lc_settled_date: "", lc_settled_amount: l.lc_amount != null ? String(l.lc_amount) : "" }); }}>Reconcile</button>}
                                            <button style={ghost} disabled={isBusy} onClick={() => deleteLcRow(r, l)}>Delete</button>
                                          </td>
                                        </tr>
                                        {editLc?.lc_id === l.lc_id && (
                                          <tr><td colSpan={9} style={{ padding: "10px 10px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)" }}>
                                            <div style={{ fontSize: 11.5, fontWeight: 650, marginBottom: 8 }}>Edit LC {l.lc_reference}</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 10, maxWidth: 900 }}>
                                              <Field label="DC reference"><input style={{ ...inputSt, width: "100%" }} value={editLc.dc_reference} onChange={(e) => editField("dc_reference", e.target.value)} /></Field>
                                              <Field label="LC reference"><input style={{ ...inputSt, width: "100%" }} value={editLc.lc_reference} onChange={(e) => editField("lc_reference", e.target.value)} /></Field>
                                              <Field label={`LC amount (${curSym(r)})`}><input type="number" min="0" step="0.01" style={{ ...inputSt, width: "100%", textAlign: "right" }} value={editLc.lc_amount} onChange={(e) => editField("lc_amount", e.target.value)} /></Field>
                                              <Field label="Issuing bank"><input style={{ ...inputSt, width: "100%" }} value={editLc.lc_bank} onChange={(e) => editField("lc_bank", e.target.value)} /></Field>
                                              <Field label="LC confirmed"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.lc_confirmed_date} onChange={(e) => editField("lc_confirmed_date", e.target.value)} /></Field>
                                              <Field label="Expected payment"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.lc_payment_date} onChange={(e) => editField("lc_payment_date", e.target.value)} /></Field>
                                              <Field label="Actual payment date"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.actual_payment_date} onChange={(e) => editField("actual_payment_date", e.target.value)} /></Field>
                                              <Field label="Loan type"><select style={{ ...inputSt, width: "100%" }} value={editLc.loan_type} onChange={(e) => editField("loan_type", e.target.value)}><option value="IMPORT">Import loan (in transit)</option><option value="TRADE">Trade loan (arrived — held by Miniso UK)</option></select></Field>
                                              <Field label="Goods arrived date"><input type="date" style={{ ...inputSt, width: "100%" }} value={editLc.goods_arrived_date} onChange={(e) => editField("goods_arrived_date", e.target.value)} /></Field>
                                            </div>
                                            <div style={{ display: "flex", gap: 8 }}>
                                              <button style={btn("var(--accent)")} disabled={isBusy || !(editLc.lc_reference || "").trim()} onClick={() => saveEditLc(r)}>Save changes</button>
                                              <button style={ghost} onClick={() => setEditLc(null)}>Cancel</button>
                                            </div>
                                          </td></tr>
                                        )}
                                        {reconLc?.lc_id === l.lc_id && !l.lc_settled && (
                                          <tr><td colSpan={9} style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", background: "var(--surface)" }}>
                                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                                              <Field label="Settled date"><input type="date" style={{ ...inputSt, width: 150 }} value={reconLc.lc_settled_date} onChange={(e) => setReconLc((s) => ({ ...s, lc_settled_date: e.target.value }))} /></Field>
                                              <Field label={`Settled amount (${curSym(r)})`}><input type="number" min="0" step="0.01" style={{ ...inputSt, width: 130, textAlign: "right" }} value={reconLc.lc_settled_amount} onChange={(e) => setReconLc((s) => ({ ...s, lc_settled_amount: e.target.value }))} /></Field>
                                              <button style={btn("var(--green)")} disabled={isBusy} onClick={() => reconcileEntry(r)}>Mark settled</button>
                                              <button style={ghost} onClick={() => setReconLc(null)}>Cancel</button>
                                            </div>
                                          </td></tr>
                                        )}
                                      </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Add an LC */}
                            {r.finance_status !== "CLOSED" && (
                              <div style={{ borderTop: lcs.length ? "1px solid var(--line)" : "none", paddingTop: lcs.length ? 12 : 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 8 }}>Add {lcs.length ? "another" : "an"} LC</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 10, maxWidth: 900 }}>
                                  <Field label="DC reference"><input style={{ ...inputSt, width: "100%" }} placeholder="e.g. DC-2026-014" value={lcForm[id]?.dc_reference || ""} onChange={(e) => setLcField(id, "dc_reference", e.target.value)} /></Field>
                                  <Field label="LC reference"><input style={{ ...inputSt, width: "100%" }} placeholder="e.g. HSBC-LC-2026-014" value={lcForm[id]?.lc_reference || ""} onChange={(e) => setLcField(id, "lc_reference", e.target.value)} /></Field>
                                  <Field label={`LC amount (${curSym(r)})`}><input type="number" min="0" step="0.01" style={{ ...inputSt, width: "100%", textAlign: "right" }} placeholder="0.00" value={lcForm[id]?.lc_amount || ""} onChange={(e) => setLcField(id, "lc_amount", e.target.value)} /></Field>
                                  <Field label="Issuing bank"><input style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_bank || ""} onChange={(e) => setLcField(id, "lc_bank", e.target.value)} /></Field>
                                  <Field label="LC confirmed"><input type="date" style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_confirmed_date || ""} onChange={(e) => setLcField(id, "lc_confirmed_date", e.target.value)} /></Field>
                                  <Field label="Expected payment"><input type="date" style={{ ...inputSt, width: "100%" }} value={lcForm[id]?.lc_payment_date || ""} onChange={(e) => setLcField(id, "lc_payment_date", e.target.value)} /></Field>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <button style={btn("var(--accent)")} disabled={isBusy || !(lcForm[id]?.lc_reference || "").trim()} onClick={() => addLcRow(r)}>Log LC</button>
                                  <button style={ghost} onClick={() => setLcFor(null)}>Close</button>
                                </div>
                              </div>
                            )}
                              </>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                      {challengeFor === id && (
                        <tr>
                          <td colSpan={12} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Challenge {procRef(r)}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8, marginBottom: 10 }}>
                              {PROC_CHALLENGE_REASONS.map((x) => (
                                <label key={x.code} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                                  <input type="checkbox" checked={chReasons.has(x.code)} onChange={(e) => toggleReason(x.code, e.target.checked)} />
                                  <span>{x.label}</span>
                                </label>
                              ))}
                            </div>
                            <textarea rows={2} placeholder="Optional note (what needs resolving)…" style={{ ...inputSt, width: "100%", resize: "vertical" }} value={chNote} onChange={(e) => setChNote(e.target.value)} />
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button style={btn("var(--red)")} disabled={chReasons.size === 0 || busy === id} onClick={() => submitChallenge(r)}>Raise challenge</button>
                              <button style={ghost} onClick={() => setChallengeFor(null)}>Cancel</button>
                              {chReasons.size === 0 && <span style={{ fontSize: 11.5, color: "var(--faint)", alignSelf: "center" }}>Choose at least one reason.</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.6 }}>
          Approve a purchase, then either record its invoice + payment (Local Purchase) or log the <strong>HSBC Letter of Credit</strong> and reconcile it on settlement (Miniso HQ), before you <strong>Close</strong> it (reported as committed procurement spend). <strong>Challenge</strong> is available on any open purchase under a controlled reason (shown &ldquo;under challenge&rdquo; until resolved). Download the current view to CSV.
        </div>
      </div>
    </div>
  );
}

// A keyed group of two <tr> rows (the row + its optional challenge panel).
function FragmentRow({ children }) {
  return <>{children}</>;
}

// A labelled field for the LC panel.
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelSt}>{label}</span>
      {children}
    </label>
  );
}
