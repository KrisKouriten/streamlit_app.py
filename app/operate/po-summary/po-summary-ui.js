"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { displayStatus, CHALLENGE_REASONS, CHALLENGE_RETURN_ROUTES, DEFAULT_CHALLENGE_RETURN_ROUTE, challengeNoteRequired, challengeReasonLabels, committedAmount, isSignedOff, poRef, PAYMENT_STATUSES, paymentStatusOf, invoiceTotals, invoicesReconcile, describePoAuditEvent } from "../../../lib/po-rules";
import MoneyInput from "../../money-input";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 12.5, fontWeight: 650, padding: "6px 12px", borderRadius: 8, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
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

const FILTERS = [
  { key: "ATTENTION", label: "Needs Finance", test: (p) => p.status === "APPROVED" && p.finance_status !== "CLOSED" },
  { key: "OPEN", label: "Open", test: (p) => displayStatus(p).code === "OPEN" },
  { key: "CHALLENGED", label: "Challenged", test: (p) => p.finance_status === "CHALLENGED" },
  { key: "CLOSED", label: "Closed", test: (p) => p.finance_status === "CLOSED" },
  { key: "ALL", label: "All", test: () => true },
];

export default function PoSummaryUI({ initialPos, departments = [] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ATTENTION");
  const [dept, setDept] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [challengeFor, setChallengeFor] = useState(null);
  const [chReasons, setChReasons] = useState(() => new Set());
  const [chNote, setChNote] = useState("");
  const [chRoute, setChRoute] = useState(DEFAULT_CHALLENGE_RETURN_ROUTE);
  const [rowErr, setRowErr] = useState({});
  const [rowMsg, setRowMsg] = useState({});
  const [busy, setBusy] = useState(null);
  const [detailFor, setDetailFor] = useState(null);   // po_id whose detail panel is open
  const [detail, setDetail] = useState({});            // po_id -> { loading, data, error }
  const [invoicesFor, setInvoicesFor] = useState(null); // po_id whose invoices panel is open
  const [invCache, setInvCache] = useState({});         // po_id -> { loading, invoices, error }
  const [invNew, setInvNew] = useState({});             // po_id -> { number, amount, paid }

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[FILTERS.length - 1];
    return initialPos.filter((p) => f.test(p) && (!dept || p.department === dept));
  }, [initialPos, filter, dept]);

  const counts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.key] = initialPos.filter((p) => f.test(p)).length;
    return c;
  }, [initialPos]);

  const setInvField = (poId, k, v) => setInv((s) => ({ ...s, [poId]: { ...s[poId], [k]: v } }));

  function toggleRow(poId, on) {
    setSelected((cur) => {
      const n = new Set(cur);
      if (on) n.add(String(poId)); else n.delete(String(poId));
      return n;
    });
  }
  function toggleAll(on) {
    setSelected(on ? new Set(rows.map((p) => String(p.po_id))) : new Set());
  }

  async function op(poId, body, successMsg) {
    setBusy(poId); setRowErr((s) => ({ ...s, [poId]: null })); setRowMsg((s) => ({ ...s, [poId]: null }));
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed");
      let msg = successMsg;
      if (j.recharge?.created) msg += ` ${j.recharge.created} recharge row${j.recharge.created === 1 ? "" : "s"} posted to Intercompany${j.recharge.unmatched ? ` (${j.recharge.unmatched} need an entity)` : ""}.`;
      setRowMsg((s) => ({ ...s, [poId]: msg }));
      router.refresh();
    } catch (e) { setRowErr((s) => ({ ...s, [poId]: e.message })); }
    finally { setBusy(null); }
  }

  const setPayment = (p, payment_status) => op(p.po_id, { op: "set-payment-status", payment_status }, `Marked ${paymentStatusOf({ payment_status }).label.toLowerCase()}.`);
  const closePo = (p) => {
    if (!window.confirm(`Close ${poRef(p)}? It will be reported as committed spend on the Departmental Budget Dashboard.`)) return;
    op(p.po_id, { op: "close" }, "Closed — now committed spend.");
  };
  const reopen = (p) => op(p.po_id, { op: "reopen-finance" }, "Re-opened.");

  function openChallenge(p) {
    setChallengeFor(p.po_id);
    setDetailFor(null);
    // pre-fill from any existing challenge
    const existing = challengeReasonLabels(p.challenge_reasons);
    const codes = CHALLENGE_REASONS.filter((r) => existing.includes(r.label)).map((r) => r.code);
    setChReasons(new Set(codes));
    setChNote(p.challenge_note || "");
    setChRoute(p.challenge_return_route || DEFAULT_CHALLENGE_RETURN_ROUTE);
  }
  function toggleReason(code, on) {
    setChReasons((cur) => { const n = new Set(cur); if (on) n.add(code); else n.delete(code); return n; });
  }
  async function submitChallenge(p) {
    await op(p.po_id, { op: "challenge", reasons: [...chReasons], note: chNote || null, returnRoute: chRoute }, "Challenge raised.");
    setChallengeFor(null); setChReasons(new Set()); setChNote(""); setChRoute(DEFAULT_CHALLENGE_RETURN_ROUTE);
  }
  const noteNeeded = challengeNoteRequired([...chReasons]);
  const challengeBlocked = chReasons.size === 0 || (noteNeeded && !chNote.trim());

  // Lazy-load a P.O's full detail (header + recharge allocation) on expand.
  async function toggleDetail(p) {
    if (detailFor === p.po_id) { setDetailFor(null); return; }
    setChallengeFor(null);
    setDetailFor(p.po_id);
    if (!detail[p.po_id]) {
      setDetail((s) => ({ ...s, [p.po_id]: { loading: true } }));
      try {
        const res = await fetch(`/api/purchase-orders/${p.po_id}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Could not load details");
        setDetail((s) => ({ ...s, [p.po_id]: { loading: false, data: j } }));
      } catch (e) {
        setDetail((s) => ({ ...s, [p.po_id]: { loading: false, error: e.message } }));
      }
    }
  }

  // ---- Multiple invoices ----
  async function loadInvoices(poId) {
    setInvCache((s) => ({ ...s, [poId]: { ...(s[poId] || {}), loading: true } }));
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load invoices");
      setInvCache((s) => ({ ...s, [poId]: { loading: false, invoices: j.invoices || [] } }));
    } catch (e) {
      setInvCache((s) => ({ ...s, [poId]: { loading: false, error: e.message } }));
    }
  }
  function toggleInvoices(p) {
    if (invoicesFor === p.po_id) { setInvoicesFor(null); return; }
    setChallengeFor(null); setDetailFor(null);
    setInvoicesFor(p.po_id);
    if (!invNew[p.po_id]) setInvNew((s) => ({ ...s, [p.po_id]: { number: "", amount: "", paid: false } }));
    if (!invCache[p.po_id]?.invoices) loadInvoices(p.po_id);
  }
  // Invoice ops POST then refresh the row + reload the invoice list.
  async function invOp(poId, body, successMsg) {
    setBusy(poId); setRowErr((s) => ({ ...s, [poId]: null })); setRowMsg((s) => ({ ...s, [poId]: null }));
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (successMsg) setRowMsg((s) => ({ ...s, [poId]: successMsg }));
      await loadInvoices(poId);
      router.refresh();
    } catch (e) { setRowErr((s) => ({ ...s, [poId]: e.message })); }
    finally { setBusy(null); }
  }
  const setInvNewField = (poId, k, v) => setInvNew((s) => ({ ...s, [poId]: { ...(s[poId] || {}), [k]: v } }));
  async function addInvoice(p) {
    const f = invNew[p.po_id] || {};
    await invOp(p.po_id, { op: "add-invoice", invoice: { invoice_number: f.number, invoice_amount: f.amount, paid: !!f.paid } }, "Invoice added.");
    setInvNew((s) => ({ ...s, [p.po_id]: { number: "", amount: "", paid: false } }));
  }
  const toggleInvoicePaid = (poId, i) => invOp(poId, { op: "update-invoice", invoice_id: i.invoice_id, patch: { paid: !i.paid } }, i.paid ? "Marked unpaid." : "Marked paid.");
  const removeInvoice = (poId, i) => { if (window.confirm(`Delete invoice ${i.invoice_number || ""}?`)) invOp(poId, { op: "delete-invoice", invoice_id: i.invoice_id }, "Invoice removed."); };

  function download(all) {
    const base = "/api/purchase-orders/export";
    const url = all || selected.size === 0 ? base : `${base}?ids=${[...selected].join(",")}`;
    window.location.href = url;
  }

  const allOn = rows.length > 0 && rows.every((p) => selected.has(String(p.po_id)));

  return (
    <div>
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
        {departments.length > 0 && (
          <select style={inputSt} value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{selected.size} selected</span>
          <button style={ghost} disabled={selected.size === 0} onClick={() => download(false)}>Download selected (Excel)</button>
          <button style={btn("var(--accent)")} onClick={() => download(true)}>Download all (Excel)</button>
        </div>
      </div>

      {/* ---- Table ---- */}
      <div style={card}>
        {!rows.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No purchase orders in this view.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1120 }}>
              <thead><tr>
                <th style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>
                  <input type="checkbox" checked={allOn} onChange={(e) => toggleAll(e.target.checked)} />
                </th>
                {["P.O number", "Dept", "Supplier", "Net value", "Status", "Payment", "Invoice no", "Invoice net (£)", "Actions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((p) => {
                  const signed = isSignedOff(p);
                  const st = displayStatus(p);
                  const isBusy = busy === p.po_id;
                  return (
                    <FragmentRow key={p.po_id}>
                      <tr>
                        <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <input type="checkbox" checked={selected.has(String(p.po_id))} onChange={(e) => toggleRow(p.po_id, e.target.checked)} />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <button onClick={() => toggleDetail(p)} title="Show P.O details" aria-expanded={detailFor === p.po_id}
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: detailFor === p.po_id ? "var(--accent)" : "var(--ink)", font: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "underline", textDecorationColor: "var(--line-strong)", textUnderlineOffset: 3 }}>
                            <span style={{ display: "inline-block", transform: detailFor === p.po_id ? "rotate(90deg)" : "none", transition: "transform .15s", color: "var(--accent)" }}>▸</span>
                            {poRef(p)}
                          </button>
                          {p.recharge_enabled && (
                            <div title={p.finance_status === "CLOSED" ? "Recharge auto-posted to Intercompany · Inventory & Recharges on close" : "Set up to be recharged — posts to Intercompany on close"}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "var(--accent)", background: "var(--accent-bg)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", whiteSpace: "nowrap" }}>
                              ⇄ Recharge · {p.recharge_ho_only ? "HO only" : "stores"}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{p.department}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{p.supplier}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>{money(p.payment_value, p.currency)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <StatusPill po={p} />
                          {st.code === "CLOSED" && <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 4 }}>Committed {money(committedAmount(p), p.currency)}</div>}
                          {p.finance_status === "CHALLENGED" && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 190, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeReasonLabels(p.challenge_reasons).join(" · ")}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          {!signed ? <span style={{ fontSize: 11.5, color: "var(--faint)" }}>—</span> : p.invoice_amount != null ? (
                            <>
                              <span style={{ display: "inline-block", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: TONE_FG[paymentStatusOf(p).tone], background: TONE_BG[paymentStatusOf(p).tone], border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}>{paymentStatusOf(p).label}</span>
                              <div style={{ fontSize: 9.5, color: "var(--faint)", marginTop: 3 }}>from invoices</div>
                              {p.paid_date && <div style={{ fontSize: 10, color: "var(--faint)" }}>{new Date(p.paid_date).toLocaleDateString("en-GB")}</div>}
                            </>
                          ) : (
                            <>
                              <select style={{ ...inputSt, width: 110, color: TONE_FG[paymentStatusOf(p).tone] }} value={paymentStatusOf(p).code} disabled={isBusy}
                                onChange={(e) => setPayment(p, e.target.value)}>
                                {PAYMENT_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                              </select>
                              {p.paid_date && <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 3 }}>{new Date(p.paid_date).toLocaleDateString("en-GB")}</div>}
                            </>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {signed ? (
                            <button onClick={() => toggleInvoices(p)} aria-expanded={invoicesFor === p.po_id}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", font: "inherit", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
                              {p.invoice_number ? p.invoice_number : "＋ Add invoice"}
                            </button>
                          ) : <span style={{ fontSize: 11.5, color: "var(--faint)" }}>—</span>}
                        </td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", textAlign: "right" }}>{p.invoice_amount != null ? money(p.invoice_amount, p.currency) : "—"}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {!signed ? (
                            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting department sign-off</span>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {p.finance_status !== "CLOSED" && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closePo(p)}>Close</button>}
                              {p.finance_status !== "CLOSED" && <button style={btn("var(--red)")} disabled={isBusy} onClick={() => openChallenge(p)}>Challenge</button>}
                              {(p.finance_status === "CLOSED" || p.finance_status === "CHALLENGED") && <button style={ghost} disabled={isBusy} onClick={() => reopen(p)}>Re-open</button>}
                            </div>
                          )}
                          {rowMsg[p.po_id] && <div style={{ color: "var(--green)", fontSize: 11.5, marginTop: 4 }}>{rowMsg[p.po_id]}</div>}
                          {rowErr[p.po_id] && <div style={{ color: "var(--red)", fontSize: 11.5, marginTop: 4 }}>{rowErr[p.po_id]}</div>}
                        </td>
                      </tr>
                      {detailFor === p.po_id && (
                        <tr>
                          <td colSpan={10} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <PoDetail state={detail[p.po_id]} po={p} money={money} />
                          </td>
                        </tr>
                      )}
                      {invoicesFor === p.po_id && (
                        <tr>
                          <td colSpan={10} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <InvoicesPanel
                              p={p} state={invCache[p.po_id]} nf={invNew[p.po_id] || { number: "", amount: "", paid: false }}
                              setField={(k, v) => setInvNewField(p.po_id, k, v)} onAdd={() => addInvoice(p)}
                              onTogglePaid={(i) => toggleInvoicePaid(p.po_id, i)} onRemove={(i) => removeInvoice(p.po_id, i)}
                              busy={busy === p.po_id} money={money} inputSt={inputSt} btn={btn} ghost={ghost}
                            />
                          </td>
                        </tr>
                      )}
                      {challengeFor === p.po_id && (
                        <tr>
                          <td colSpan={10} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Challenge P.O {p.xero_po_number}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 8, marginBottom: 10 }}>
                              {CHALLENGE_REASONS.map((r) => (
                                <label key={r.code} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                                  <input type="checkbox" checked={chReasons.has(r.code)} onChange={(e) => toggleReason(r.code, e.target.checked)} />
                                  <span>{r.label}</span>
                                </label>
                              ))}
                            </div>
                            <textarea rows={2} placeholder={noteNeeded ? "Required — explain the ‘Other’ reason for the department…" : "Optional note for the department (what needs resolving)…"} style={{ ...inputSt, width: "100%", resize: "vertical", borderColor: noteNeeded && !chNote.trim() ? "var(--red)" : "var(--line)" }} value={chNote} onChange={(e) => setChNote(e.target.value)} />
                            <div style={{ marginTop: 10 }}>
                              <div style={{ ...labelSt, marginBottom: 5 }}>After the submitter fixes it</div>
                              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                {CHALLENGE_RETURN_ROUTES.map((r) => (
                                  <label key={r.code} style={{ display: "flex", gap: 6, fontSize: 12.5, alignItems: "center" }}>
                                    <input type="radio" name={`chRoute-${p.po_id}`} checked={chRoute === r.code} onChange={() => setChRoute(r.code)} />
                                    <span>{r.label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button style={btn("var(--red)")} disabled={challengeBlocked || busy === p.po_id} onClick={() => submitChallenge(p)}>Raise challenge</button>
                              <button style={ghost} onClick={() => setChallengeFor(null)}>Cancel</button>
                              {chReasons.size === 0 && <span style={{ fontSize: 11.5, color: "var(--faint)", alignSelf: "center" }}>Choose at least one reason.</span>}
                              {chReasons.size > 0 && noteNeeded && !chNote.trim() && <span style={{ fontSize: 11.5, color: "var(--faint)", alignSelf: "center" }}>Add a note for ‘Other’.</span>}
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
          Click a <strong>P.O number</strong> (▸) to expand it and see its full details. Click the <strong>Invoice no</strong> cell to add one or more invoices to a P.O — each with its own paid state, so the Payment status rolls up to <em>Part-paid</em> until all are paid. Then <strong>Close</strong> it (reported as committed spend on the Departmental Budget Dashboard) or <strong>Challenge</strong> it — pick the reason(s) (or &ldquo;Other&rdquo; with a note) and choose whether the fix comes back to Finance or goes back for department sign-off. A challenged P.O shows &ldquo;under challenge&rdquo; on the dashboard and Purchase Order Requests, where the submitter can edit and resubmit it. Downloads include a row per store allocation so every store&rsquo;s value to invoice or recharge is listed.
        </div>
      </div>
    </div>
  );
}

// A keyed group of <tr> rows (the row + its optional detail / challenge panels).
function FragmentRow({ children }) {
  return <>{children}</>;
}

// The invoices panel — list each invoice against a P.O with its paid toggle, add
// a new one, and see the invoiced total reconcile against the P.O value.
function InvoicesPanel({ p, state, nf, setField, onAdd, onTogglePaid, onRemove, busy, money, inputSt, btn, ghost }) {
  const invoices = state?.invoices || [];
  const t = invoiceTotals(invoices);
  const reconciles = invoicesReconcile(invoices, p.payment_value);
  const closed = p.finance_status === "CLOSED";
  const lbl = { fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)" };
  const canAdd = String(nf.number || "").trim() && Number(nf.amount) > 0;
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Invoices — {p.xero_po_number || p.po_number} <span style={{ fontWeight: 400, color: "var(--faint)" }}>· P.O value {money(p.payment_value, p.currency)}</span></div>
      {state?.loading && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Loading invoices…</div>}
      {state?.error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{state.error}</div>}
      {!state?.loading && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, maxWidth: 720 }}>
          <thead><tr>{["Invoice no", "Amount", "Paid", ""].map((h, i) => (
            <th key={h} style={{ textAlign: i === 1 ? "right" : "left", padding: "4px 8px", ...lbl, borderBottom: "1px solid var(--line)" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.invoice_id}>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--hairline)" }}>{i.invoice_number || "—"}</td>
                <td className="fos-num" style={{ padding: "5px 8px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>{money(i.invoice_amount, p.currency)}</td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--hairline)" }}>
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: closed ? "default" : "pointer" }}>
                    <input type="checkbox" checked={!!i.paid} disabled={busy || closed} onChange={() => onTogglePaid(i)} />
                    <span style={{ color: i.paid ? "var(--green)" : "var(--muted)" }}>{i.paid ? `Paid${i.paid_date ? ` · ${new Date(i.paid_date).toLocaleDateString("en-GB")}` : ""}` : "Unpaid"}</span>
                  </label>
                </td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--hairline)", textAlign: "right" }}>
                  {!closed && <button style={{ ...ghost, color: "var(--red)", padding: "3px 8px" }} disabled={busy} onClick={() => onRemove(i)}>Delete</button>}
                </td>
              </tr>
            ))}
            {!invoices.length && !state?.loading && <tr><td colSpan={4} style={{ padding: "8px", color: "var(--faint)" }}>No invoices yet — add the first below.</td></tr>}
          </tbody>
          {invoices.length > 0 && (
            <tfoot><tr>
              <td style={{ padding: "6px 8px", fontWeight: 650 }}>Total · {t.count} invoice{t.count === 1 ? "" : "s"} <span style={{ fontWeight: 400, color: "var(--faint)" }}>({money(t.paid, p.currency)} paid)</span></td>
              <td className="fos-num" style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: reconciles ? "var(--green)" : "var(--amber)" }}>{money(t.total, p.currency)}</td>
              <td colSpan={2} style={{ padding: "6px 8px", fontSize: 11.5, color: reconciles ? "var(--green)" : "var(--amber)" }}>{reconciles ? "✓ reconciles to P.O" : `${money(Math.abs(t.total - (Number(p.payment_value) || 0)), p.currency)} vs P.O value`}</td>
            </tr></tfoot>
          )}
        </table>
      )}
      {!closed && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={lbl}>Invoice no</span><input style={{ ...inputSt, width: 150 }} value={nf.number} onChange={(e) => setField("number", e.target.value)} placeholder="e.g. INV-1042" /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={lbl}>Amount (£)</span><input style={{ ...inputSt, width: 120, textAlign: "right" }} className="fos-num" value={nf.amount} onChange={(e) => setField("amount", e.target.value)} placeholder="0.00" /></label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, paddingBottom: 8 }}><input type="checkbox" checked={!!nf.paid} onChange={(e) => setField("paid", e.target.checked)} /> Paid</label>
          <button style={{ ...btn("var(--accent)"), padding: "7px 14px" }} disabled={busy || !canAdd} onClick={onAdd}>Add invoice</button>
        </div>
      )}
      {closed && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>This P.O is closed — re-open it to change its invoices.</div>}
    </div>
  );
}

const routeLabel = (code) => (CHALLENGE_RETURN_ROUTES.find((r) => r.code === code) || {}).label || null;
const ukDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");

// The expandable P.O detail panel — header fields, marketing tags, recharge
// allocation and any live challenge — loaded on demand so the summary table
// stays light. `state` is { loading } | { data:{ po, recharge } } | { error }.
function PoDetail({ state, po, money }) {
  if (!state || state.loading) return <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Loading details…</div>;
  if (state.error) return <div style={{ fontSize: 12.5, color: "var(--red)" }}>{state.error}</div>;
  const d = state.data?.po || po;
  const recharge = state.data?.recharge || [];
  const dl = { fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 2 };
  const dv = { fontSize: 13, color: "var(--ink)" };
  const Item = ({ k, children }) => (<div><div style={dl}>{k}</div><div style={dv}>{children ?? "—"}</div></div>);
  const reasons = challengeReasonLabels(d.challenge_reasons);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "12px 20px" }}>
        <Item k="P.O date">{ukDate(d.po_date)}</Item>
        <Item k="Category">{d.po_category}</Item>
        <Item k="Submitted by">{d.created_by ? String(d.created_by).split("@")[0] : "—"}</Item>
        <Item k="Net value">{money(d.payment_value, d.currency)}</Item>
        <Item k="Payment terms">{d.payment_terms}</Item>
        <Item k="Due date">{ukDate(d.payment_date)}</Item>
        <Item k="Fulfilment start">{ukDate(d.fulfilment_start_date)}</Item>
        <Item k="Fulfilment days">{d.fulfilment_days ?? "—"}</Item>
        <Item k="Invoice no">{d.invoice_number}</Item>
        <Item k="Invoice net">{d.invoice_amount != null ? money(d.invoice_amount, d.currency) : "—"}</Item>
        {d.is_marketing && <Item k="Marketing">{d.marketing_levy ? "Levy — allocate, no invoice" : "Non-levy — finance to invoice"}</Item>}
        {d.marketing_budget_category && <Item k="Budget link">{d.marketing_budget_category}</Item>}
        {d.marketing_campaign && <Item k="Campaign">{d.marketing_campaign}</Item>}
      </div>
      {d.notes && (
        <div style={{ marginTop: 12 }}>
          <div style={dl}>Notes</div>
          <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{d.notes}</div>
        </div>
      )}
      {recharge.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={dl}>Recharge allocation</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {recharge.map((r) => (
              <span key={r.recharge_id ?? `${r.store_code}-${r.store_name}`} style={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}>
                {r.store_name || r.store_code} · {Number(r.pct)}%{r.amount != null ? ` · ${money(r.amount, d.currency)}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {d.finance_status === "CHALLENGED" && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--red)" }}>Under challenge — {reasons.join(" · ")}</div>
          {d.challenge_note && <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 4 }}>{d.challenge_note}</div>}
          {routeLabel(d.challenge_return_route) && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>On fix: {routeLabel(d.challenge_return_route)}</div>}
        </div>
      )}
      <PoAuditTrail events={state.data?.auditTrail} />
    </div>
  );
}

// The full audit trail for a P.O — a read-only timeline of every governed event
// (raised, self / line-manager / finance approvals, challenges, reissues, closes
// and record updates), oldest first, with actor and timestamp. Drawn from
// governance.audit_event via getPo, so it needs no separate load.
const AUDIT_TONE = { accent: "var(--accent)", green: "var(--green)", red: "var(--red)", amber: "var(--amber)", muted: "var(--faint)" };
const auditWhen = (v) => {
  if (!v) return "—";
  const dt = new Date(v);
  return `${dt.toLocaleDateString("en-GB")} ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
function PoAuditTrail({ events }) {
  const dl = { fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 };
  if (!Array.isArray(events)) return null;
  if (!events.length) {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={dl}>Audit trail</div>
        <div style={{ fontSize: 12, color: "var(--faint)" }}>No recorded events for this P.O yet.</div>
      </div>
    );
  }
  const items = events.map(describePoAuditEvent);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={dl}>Audit trail</div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
        {items.map((e, i) => {
          const colour = AUDIT_TONE[e.tone] || AUDIT_TONE.muted;
          const last = i === items.length - 1;
          return (
            <li key={i} style={{ position: "relative", paddingLeft: 22, paddingBottom: last ? 0 : 14 }}>
              {!last && <span aria-hidden style={{ position: "absolute", left: 5, top: 12, bottom: 0, width: 1, background: "var(--hairline)" }} />}
              <span aria-hidden style={{ position: "absolute", left: 0, top: 3, width: 11, height: 11, borderRadius: "50%", background: colour, boxShadow: "0 0 0 3px var(--raise)" }} />
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{e.label}</div>
              {e.detail && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{e.detail}</div>}
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                {auditWhen(e.at)}{e.actor ? ` · ${e.actor}` : ""}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
