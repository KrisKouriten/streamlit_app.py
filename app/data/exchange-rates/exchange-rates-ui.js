"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FX_RATE_TYPES, FX_CURRENCY_SUGGESTIONS, currenciesInRates, isValidCcyCode, normaliseCcy } from "../../../lib/fx-rules";

/* The FX rate desk. Rates are quoted as foreign units per £1 (GBPccy, e.g.
   1.2700), so GBP = amount ÷ rate. One block per currency, each carrying the
   three rate types. Finance edits inline and can put a new currency on the desk;
   everyone else sees it read-only. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { height: 30, fontSize: 12.5, padding: "0 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink)" };
const btn = { fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer" };
const ghost = { fontSize: 12, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };

const nameOf = (v) => (v && v !== "seed" ? String(v).split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null);
const CCY_NAME = Object.fromEntries(FX_CURRENCY_SUGGESTIONS);

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
  const currencies = useMemo(() => currenciesInRates(rates), [rates]);

  async function save(ccy, rt, rate, note) {
    setErr(""); setBusy(`${ccy}·${rt}`);
    try { await post({ action: "set-fx-rate", currency: ccy, rate_type: rt, rate: Number(rate), note }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }
  async function addCurrency(ccy) {
    setErr(""); setBusy("add");
    try { await post({ action: "add-fx-currency", currency: ccy }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }
  async function removeCurrency(ccy) {
    if (!window.confirm(`Take ${ccy} off the rate desk? Its three rates are deleted.`)) return;
    setErr(""); setBusy(`rm·${ccy}`);
    try { await post({ action: "remove-fx-currency", currency: ccy }); router.refresh(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div style={{ ...card, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
        Rates are quoted as <strong>foreign units per £1</strong> (GBPccy, e.g. <span style={{ fontFamily: "var(--mono)" }}>1.2700</span>), so <span style={{ fontFamily: "var(--mono)" }}>GBP = amount ÷ rate</span>. Everything is converted against sterling. When a foreign procurement order is approved, Finance picks the <strong>actual-cost</strong> rate to settle the cashflow and the <strong>arrival valuation</strong> rate to value closing stock; the difference between the two lands on the P&amp;L.
        {" "}A rate left unset reads as <span style={{ fontFamily: "var(--mono)" }}>—</span> and nothing converts at it — no figure is invented from a placeholder.
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{err}</div>}

      {currencies.map((ccy) => (
        <CurrencyBlock
          key={ccy} ccy={ccy} rates={rates} isFinance={isFinance} busy={busy}
          onSave={save} onRemove={removeCurrency}
        />
      ))}

      {isFinance && <AddCurrency existing={currencies} busy={busy === "add"} onAdd={addCurrency} />}
      {!isFinance && <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Only Finance can amend the exchange rates.</div>}
    </>
  );
}

function CurrencyBlock({ ccy, rates, isFinance, busy, onSave, onRemove }) {
  const rowFor = (rt) => rates.find((r) => normaliseCcy(r.currency) === ccy && String(r.rate_type).toUpperCase() === rt) || {};
  const unset = FX_RATE_TYPES.filter((t) => rowFor(t.key).rate == null).length;
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 650, fontFamily: "var(--mono)" }}>{ccy}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{CCY_NAME[ccy] || "against sterling"}</span>
        {/* An unset rate is not a rounding problem: nothing priced in this
            currency can be valued until it is filled in, and the figure reads
            as absent rather than as nil. Worth saying at the top of the block. */}
        {unset > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--amber)" }}>
            {unset} of {FX_RATE_TYPES.length} not set — nothing converts at a rate that is missing
          </span>
        )}
        {isFinance && (
          <button style={{ ...ghost, marginLeft: "auto" }} disabled={busy === `rm·${ccy}`} onClick={() => onRemove(ccy)}>
            {busy === `rm·${ccy}` ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
          <thead><tr>{["Rate", "What it's for", `${ccy} per £1`, "Updated", isFinance ? "" : null].filter((h) => h !== null).map((h, i) => (
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
                  <td className="fos-num" style={{ padding: "10px 12px", borderBottom: bb, textAlign: "right", fontWeight: 600, color: row.rate == null ? "var(--faint)" : undefined }}>
                    {row.rate != null ? Number(row.rate).toFixed(4) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: bb, color: "var(--faint)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {row.rate != null && row.updated_at ? new Date(row.updated_at).toLocaleDateString("en-GB") : "—"}{row.rate != null && who ? ` · ${who}` : ""}
                  </td>
                  {isFinance && (
                    <td style={{ padding: "10px 12px", borderBottom: bb, textAlign: "right", whiteSpace: "nowrap" }}>
                      <RateEditor rate={row.rate} note={row.note} busy={busy === `${ccy}·${t.key}`} onSave={(rate, note) => onSave(ccy, t.key, rate, note)} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/*
 * Put a currency on the desk.
 *
 * The picker is a convenience, not a limit — any three-letter code can be typed,
 * because a currency the business starts trading in should not need a deploy.
 * GBP is refused: sterling has no rate against itself.
 */
function AddCurrency({ existing, busy, onAdd }) {
  const [ccy, setCcy] = useState("");
  const code = normaliseCcy(ccy);
  const already = existing.includes(code);
  const ok = isValidCcyCode(code) && !already;
  const options = FX_CURRENCY_SUGGESTIONS.filter(([c]) => !existing.includes(c));
  return (
    <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Add a currency</span>
      <input
        list="fx-ccy-options" value={ccy} onChange={(e) => setCcy(e.target.value)}
        placeholder="EUR" maxLength={3}
        style={{ ...inputSt, width: 92, fontFamily: "var(--mono)", textTransform: "uppercase" }}
      />
      <datalist id="fx-ccy-options">
        {options.map(([c, name]) => <option key={c} value={c}>{`${c} — ${name}`}</option>)}
      </datalist>
      <button style={ok && !busy ? btn : { ...btn, opacity: 0.5, cursor: "default" }} disabled={!ok || busy} onClick={() => onAdd(code)}>
        {busy ? "Adding…" : "Add"}
      </button>
      <span style={{ fontSize: 11.5, color: already ? "var(--amber)" : "var(--faint)" }}>
        {already
          ? `${code} is already on the desk.`
          : code && !isValidCcyCode(code)
            ? (code === "GBP" ? "Sterling has no rate against itself." : "Three letters, e.g. EUR.")
            : `Adds ${FX_RATE_TYPES.map((t) => t.label.replace(/ rate$/, "")).join(", ")} for that currency, each unset until you fill it in.`}
      </span>
    </div>
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
