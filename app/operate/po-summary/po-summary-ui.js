"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { displayStatus, CHALLENGE_REASONS, challengeReasonLabels, committedAmount, isSignedOff } from "../../../lib/po-rules";

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
  const [inv, setInv] = useState(() => {
    const m = {};
    for (const p of initialPos) m[p.po_id] = { number: p.invoice_number || "", amount: p.invoice_amount != null ? String(p.invoice_amount) : "" };
    return m;
  });
  const [challengeFor, setChallengeFor] = useState(null);
  const [chReasons, setChReasons] = useState(() => new Set());
  const [chNote, setChNote] = useState("");
  const [rowErr, setRowErr] = useState({});
  const [rowMsg, setRowMsg] = useState({});
  const [busy, setBusy] = useState(null);

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
      setRowMsg((s) => ({ ...s, [poId]: successMsg }));
      router.refresh();
    } catch (e) { setRowErr((s) => ({ ...s, [poId]: e.message })); }
    finally { setBusy(null); }
  }

  const saveInvoice = (p) => op(p.po_id, { op: "set-invoice", invoice_number: inv[p.po_id]?.number || null, invoice_amount: inv[p.po_id]?.amount || null }, "Invoice saved.");
  const closePo = (p) => {
    if (!window.confirm(`Close P.O ${p.xero_po_number}? It will be reported as committed spend on the Departmental Budget Dashboard.`)) return;
    op(p.po_id, { op: "close", invoice_number: inv[p.po_id]?.number || null, invoice_amount: inv[p.po_id]?.amount || null }, "Closed — now committed spend.");
  };
  const reopen = (p) => op(p.po_id, { op: "reopen-finance" }, "Re-opened.");

  function openChallenge(p) {
    setChallengeFor(p.po_id);
    // pre-fill from any existing challenge
    const existing = challengeReasonLabels(p.challenge_reasons);
    const codes = CHALLENGE_REASONS.filter((r) => existing.includes(r.label)).map((r) => r.code);
    setChReasons(new Set(codes));
    setChNote(p.challenge_note || "");
  }
  function toggleReason(code, on) {
    setChReasons((cur) => { const n = new Set(cur); if (on) n.add(code); else n.delete(code); return n; });
  }
  async function submitChallenge(p) {
    await op(p.po_id, { op: "challenge", reasons: [...chReasons], note: chNote || null }, "Challenge raised.");
    setChallengeFor(null); setChReasons(new Set()); setChNote("");
  }

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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 980 }}>
              <thead><tr>
                <th style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>
                  <input type="checkbox" checked={allOn} onChange={(e) => toggleAll(e.target.checked)} />
                </th>
                {["Xero P.O", "Dept", "Supplier", "Net value", "Status", "Invoice no", "Invoice net (£)", "Actions"].map((h) => (
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
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{p.xero_po_number}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{p.department}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>{p.supplier}</td>
                        <td className="fos-num" style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", textAlign: "right", verticalAlign: "top" }}>{money(p.payment_value, p.currency)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <StatusPill po={p} />
                          {st.code === "CLOSED" && <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 4 }}>Committed {money(committedAmount(p), p.currency)}</div>}
                          {p.finance_status === "CHALLENGED" && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 4, maxWidth: 190, whiteSpace: "normal", lineHeight: 1.4 }}>{challengeReasonLabels(p.challenge_reasons).join(" · ")}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <input style={{ ...inputSt, width: 120 }} placeholder="—" value={inv[p.po_id]?.number || ""} disabled={!signed} onChange={(e) => setInvField(p.po_id, "number", e.target.value)} />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" }}>
                          <input type="number" min="0" step="0.01" style={{ ...inputSt, width: 110, textAlign: "right" }} placeholder="—" value={inv[p.po_id]?.amount || ""} disabled={!signed} onChange={(e) => setInvField(p.po_id, "amount", e.target.value)} />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {!signed ? (
                            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Awaiting department sign-off</span>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button style={ghost} disabled={isBusy} onClick={() => saveInvoice(p)}>Save invoice</button>
                              {p.finance_status !== "CLOSED" && <button style={btn("var(--green)")} disabled={isBusy} onClick={() => closePo(p)}>Close</button>}
                              {p.finance_status !== "CLOSED" && <button style={btn("var(--red)")} disabled={isBusy} onClick={() => openChallenge(p)}>Challenge</button>}
                              {(p.finance_status === "CLOSED" || p.finance_status === "CHALLENGED") && <button style={ghost} disabled={isBusy} onClick={() => reopen(p)}>Re-open</button>}
                            </div>
                          )}
                          {rowMsg[p.po_id] && <div style={{ color: "var(--green)", fontSize: 11.5, marginTop: 4 }}>{rowMsg[p.po_id]}</div>}
                          {rowErr[p.po_id] && <div style={{ color: "var(--red)", fontSize: 11.5, marginTop: 4 }}>{rowErr[p.po_id]}</div>}
                        </td>
                      </tr>
                      {challengeFor === p.po_id && (
                        <tr>
                          <td colSpan={9} style={{ padding: "14px 16px", borderBottom: "1px solid var(--hairline)", background: "var(--raise)" }}>
                            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Challenge P.O {p.xero_po_number}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 8, marginBottom: 10 }}>
                              {CHALLENGE_REASONS.map((r) => (
                                <label key={r.code} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                                  <input type="checkbox" checked={chReasons.has(r.code)} onChange={(e) => toggleReason(r.code, e.target.checked)} />
                                  <span>{r.label}</span>
                                </label>
                              ))}
                            </div>
                            <textarea rows={2} placeholder="Optional note for the department (what needs resolving)…" style={{ ...inputSt, width: "100%", resize: "vertical" }} value={chNote} onChange={(e) => setChNote(e.target.value)} />
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button style={btn("var(--red)")} disabled={chReasons.size === 0 || busy === p.po_id} onClick={() => submitChallenge(p)}>Raise challenge</button>
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
          Record the invoice number and net amount against a signed-off P.O, then <strong>Close</strong> it (reported as committed spend on the Departmental Budget Dashboard) or <strong>Challenge</strong> it under one of the four reasons (shown &ldquo;under challenge&rdquo; on the dashboard and Purchase Order Requests until resolved). Downloads include a row per store allocation so every store&rsquo;s value to invoice or recharge is listed.
        </div>
      </div>
    </div>
  );
}

// A keyed group of two <tr> rows (the row + its optional challenge panel).
function FragmentRow({ children }) {
  return <>{children}</>;
}
