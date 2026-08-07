"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FX_RATE_TYPES } from "../../../lib/fx-rules";

/* The USD→GBP rate desk. Rates are quoted as USD per £1 (GBPUSD, e.g. 1.2700),
   so GBP = USD amount ÷ rate. Finance edits each rate inline; others see them
   read-only. Saving posts to /api/fx and refreshes the server data. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { height: 30, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" };
const btn = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer" };

const nameOf = (v) => (v && v !== "seed" ? String(v).split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null);

async function post(body) {
  const res = await fetch("/api/fx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

export default function ExchangeRatesUI({ rates = [], isFinance }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const rowFor = (rt) => rates.find((r) => String(r.currency).toUpperCase() === "USD" && String(r.rate_type).toUpperCase() === rt) || {};

  async function save(rt, rate, note) {
    setErr(""); setBusy(rt);
    try { await post({ action: "set-fx-rate", currency: "USD", rate_type: rt, rate: Number(rate), note }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div style={{ ...card, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
        Rates are quoted as <strong>USD per £1</strong> (GBPUSD, e.g. <span style={{ fontFamily: "var(--mono)" }}>1.2700</span>), so <span style={{ fontFamily: "var(--mono)" }}>GBP = USD ÷ rate</span>. USD is the only foreign currency for now, converted against GBP. When a USD procurement order is approved, Finance picks the <strong>actual-cost</strong> rate to settle the cashflow and the <strong>arrival valuation</strong> rate to value closing stock; the difference between the two lands on the P&amp;L.
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{err}</div>}

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
            <thead><tr>{["Rate", "What it's for", "USD per £1", "Updated", isFinance ? "" : null].filter((h) => h !== null).map((h, i) => (
              <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "10px 12px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {FX_RATE_TYPES.map((t, i) => {
                const row = rowFor(t.key);
                const bb = i === FX_RATE_TYPES.length - 1 ? "none" : "1px solid var(--hairline)";
                const who = nameOf(row.updated_by);
                return (
                  <tr key={t.key}>
                    <td style={{ padding: "10px 12px", borderBottom: bb, fontWeight: 600 }}>{t.label}</td>
                    <td style={{ padding: "10px 12px", borderBottom: bb, color: "var(--muted)" }}>{t.hint}</td>
                    <td className="fos-num" style={{ padding: "10px 12px", borderBottom: bb, textAlign: "right", fontWeight: 600 }}>{row.rate != null ? Number(row.rate).toFixed(4) : "—"}</td>
                    <td style={{ padding: "10px 12px", borderBottom: bb, color: "var(--faint)", fontSize: 11.5, whiteSpace: "nowrap" }}>{row.updated_at ? new Date(row.updated_at).toLocaleDateString("en-GB") : "—"}{who ? ` · ${who}` : ""}</td>
                    {isFinance && (
                      <td style={{ padding: "10px 12px", borderBottom: bb, textAlign: "right", whiteSpace: "nowrap" }}>
                        <RateEditor rate={row.rate} note={row.note} busy={busy === t.key} onSave={(rate, note) => save(t.key, rate, note)} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!isFinance && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12 }}>Only Finance can amend the exchange rates.</div>}
      </div>
    </>
  );
}

function RateEditor({ rate, note, busy, onSave }) {
  const [r, setR] = useState(rate != null ? String(rate) : "");
  const [n, setN] = useState(note || "");
  useEffect(() => { setR(rate != null ? String(rate) : ""); setN(note || ""); }, [rate, note]);
  const dirty = r !== (rate != null ? String(rate) : "") || n !== (note || "");
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <input type="number" step="0.0001" min="0" value={r} onChange={(e) => setR(e.target.value)} placeholder="1.2700" style={{ ...inputSt, width: 96, textAlign: "right" }} className="fos-num" />
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="note (optional)" style={{ ...inputSt, width: 170 }} />
      <button style={busy || !dirty || !(Number(r) > 0) ? { ...btn, opacity: 0.5, cursor: "default" } : btn} disabled={busy || !dirty || !(Number(r) > 0)} onClick={() => onSave(r, n)}>{busy ? "Saving…" : "Save"}</button>
    </span>
  );
}
