"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  displayStatus, PROC_CHALLENGE_REASONS, challengeReasonLabels, PROC_PAYMENT_STATUSES,
  paymentStatusOf, committedAmount, lineValue, procRef, isMerchRequest, financeActionError,
} from "../../../lib/procurement-close-rules";
import { money, StatRow, Stat, Badge } from "../../finance-os/ui";

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
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

  function download() {
    const head = ["Reference", "Source", "Supplier", "Channel / Category", "Net value", "Finance status", "Payment status", "Invoice no", "Invoice net"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of rows) {
      lines.push([
        procRef(r), r.source, r.supplier, channelCategory(r), lineValue(r),
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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1180 }}>
              <thead><tr>
                {["Reference", "Source", "Type", "Supplier", "Channel / Category", "Net", "Invoice no", "Invoice net", "Status", "Payment", "Actions"].map((h) => (
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
                          {fs === "CLOSED" && <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>Committed {money(committedAmount(r))}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{r.invoice_number || "—"}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>{r.invoice_amount != null ? money(r.invoice_amount) : "—"}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {fs === "CHALLENGED" && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 190, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeReasonLabels(r.challenge_reasons).join(" · ")}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}><Badge tone={pay.tone}>{pay.label}</Badge></td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {fs === "PENDING" && financeActionError("approve", r) === null && (
                            <button style={btn("var(--green)")} disabled={isBusy} onClick={() => approve(r)}>Approve</button>
                          )}
                          {fs === "APPROVED" && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <input style={{ ...inputSt, width: 110 }} placeholder="Invoice no" value={inv[id]?.number || ""} onChange={(e) => setInvField(id, "number", e.target.value)} />
                              <input type="number" min="0" step="0.01" style={{ ...inputSt, width: 100, textAlign: "right" }} placeholder="Invoice net" value={inv[id]?.amount || ""} onChange={(e) => setInvField(id, "amount", e.target.value)} />
                              {financeActionError("invoice", r) === null && <button style={ghost} disabled={isBusy} onClick={() => saveInvoice(r)}>Save invoice</button>}
                              {financeActionError("payment", r) === null && (
                                <select style={{ ...inputSt, width: 110, color: TONE_FG[pay.tone] }} value={pay.code} disabled={isBusy} onChange={(e) => setPayment(r, e.target.value)}>
                                  {PROC_PAYMENT_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                                </select>
                              )}
                              {financeActionError("close", r) === null && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closeRow(r)}>Close</button>}
                              {financeActionError("challenge", r) === null && <button style={btn("var(--red)")} disabled={isBusy} onClick={() => openChallenge(r)}>Challenge</button>}
                            </div>
                          )}
                          {fs === "CHALLENGED" && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {financeActionError("reopen", r) === null && <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>}
                              {financeActionError("close", r) === null && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closeRow(r)}>Close</button>}
                            </div>
                          )}
                          {fs === "CLOSED" && financeActionError("reopen", r) === null && (
                            <button style={ghost} disabled={isBusy} onClick={() => reopen(r)}>Re-open</button>
                          )}
                        </td>
                      </tr>
                      {challengeFor === id && (
                        <tr>
                          <td colSpan={11} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
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
          Approve a purchase, record its invoice number and net amount, then <strong>Close</strong> it (reported as committed procurement spend) or <strong>Challenge</strong> it under a controlled reason (shown &ldquo;under challenge&rdquo; until resolved). Download the current view to CSV.
        </div>
      </div>
    </div>
  );
}

// A keyed group of two <tr> rows (the row + its optional challenge panel).
function FragmentRow({ children }) {
  return <>{children}</>;
}
