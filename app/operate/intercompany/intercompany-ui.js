"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

const input = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13.5, width: "100%" };
const btn = (bg = "var(--accent)", fg = "#1a1813") => ({ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: bg, color: fg, fontSize: 13, fontWeight: 600, cursor: "pointer" });
const ghost = { height: 34, padding: "0 12px", background: "transparent", color: "var(--muted)", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 12.5, cursor: "pointer" };
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

async function api(body) {
  const res = await fetch("/api/intercompany", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Action failed");
  return data;
}

export default function IntercompanyUI({ cats, entities, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState(cats[0].key);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const cat = cats.find((c) => c.key === tab);

  return (
    <div>
      {/* tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {cats.map((c) => {
          const on = c.key === tab;
          return (
            <button key={c.key} onClick={() => { setTab(c.key); setMsg(""); setErr(""); }} style={{
              fontSize: 12.5, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
              background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--muted)", fontWeight: on ? 700 : 500,
            }}>{c.label} <span style={{ opacity: 0.7 }}>· {c.summary.n}</span></button>
          );
        })}
      </div>

      {/* summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        <Tile label="Transactions" value={cat.summary.n} />
        <Tile label="Total value" value={money(cat.summary.total, { compact: true })} />
        <Tile label="Balance-sheet reconciled" value={`${cat.summary.bs_reconciled} / ${cat.summary.n}`} tone={cat.summary.n && cat.summary.bs_reconciled === cat.summary.n ? "green" : cat.summary.bs_reconciled ? "amber" : undefined} />
      </div>

      {canManage && <Controls cat={cat} entities={entities} router={router} setMsg={setMsg} setErr={setErr} />}
      {msg && <div style={{ fontSize: 12.5, color: "var(--green)", margin: "8px 0" }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", margin: "8px 0", whiteSpace: "pre-wrap" }}>{err}</div>}

      {/* table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
          <thead><tr>
            {["Date", "Credit (out) → Debit (in)", cat.amountLabel, cat.cols.includes("invoice_number") ? "Invoice" : null,
              cat.cols.includes("supplier_name") ? "Supplier" : null, "Reference", "Reconciliation"].filter((x) => x !== null).map((h, i) => (
              <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {cat.txns.length === 0 && <tr><td colSpan={7} style={{ padding: "16px", color: "var(--faint)", fontSize: 13 }}>No transactions yet. {canManage ? "Add one or upload a CSV." : ""}</td></tr>}
            {cat.txns.map((t) => (
              <tr key={t.txn_id}>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", color: "var(--muted)" }}>{dateStr(t.txn_date)}</td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 560 }}>{t.credit_name || "?"}</span> <span style={{ color: "var(--faint)" }}>→</span> <span style={{ fontWeight: 560 }}>{t.debit_name || "?"}</span>
                </td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(t.gross_amount)}</td>
                {cat.cols.includes("invoice_number") && <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", color: "var(--muted)", whiteSpace: "nowrap" }}>{t.invoice_number || "—"}</td>}
                {cat.cols.includes("supplier_name") && <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", color: "var(--muted)", whiteSpace: "nowrap" }}>{t.supplier_name || "—"}</td>}
                <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", color: "var(--muted)", whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 11.5 }}>{t.reference || "—"}</td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {cat.recon.map(([flag, label]) => (
                      <ReconChip key={flag} txnId={t.txn_id} flag={flag} label={label} value={t[flag]} canManage={canManage} router={router} setErr={setErr} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }) {
  const c = tone === "green" ? "var(--green)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: c }}>{value}</div>
    </div>
  );
}

function ReconChip({ txnId, flag, label, value, canManage, router, setErr }) {
  const [v, setV] = useState(value);
  const short = label.replace(" reconciled", "").replace("Balance sheet", "BS");
  async function toggle() {
    if (!canManage) return;
    const nv = !v; setV(nv);
    try { await api({ action: "recon", txnId, flag, value: nv }); router.refresh(); }
    catch (e) { setV(v); setErr(e.message); }
  }
  return (
    <button onClick={toggle} disabled={!canManage} title={label} style={{
      fontSize: 9.5, fontWeight: 600, padding: "2px 7px", borderRadius: 5, cursor: canManage ? "pointer" : "default",
      border: `1px solid ${v ? "var(--green)" : "var(--line-strong)"}`,
      background: v ? "var(--green-bg)" : "transparent", color: v ? "var(--green)" : "var(--faint)", whiteSpace: "nowrap",
    }}>{v ? "✓" : "○"} {short}</button>
  );
}

function Controls({ cat, entities, router, setMsg, setErr }) {
  const [adding, setAdding] = useState(false);
  const fileRef = useRef(null);
  async function upload(e) {
    setErr(""); setMsg("");
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try {
      const r = await api({ action: "upload", category: cat.key, csv: text });
      setMsg(`Uploaded ${r.inserted} of ${r.parsed} rows.${r.errors?.length ? ` ${r.errors.length} skipped.` : ""}`);
      if (r.errors?.length) setErr("Skipped rows:\n" + r.errors.slice(0, 8).map((x) => `· ${x.reason}${x.row ? ` (row ${x.row})` : ""}`).join("\n"));
      router.refresh();
    } catch (er) { setErr(er.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn()} onClick={() => setAdding((x) => !x)}>{adding ? "Close" : "Add transaction"}</button>
        <label style={{ ...ghost, display: "inline-flex", alignItems: "center", lineHeight: "34px" }}>
          Upload CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={upload} style={{ display: "none" }} />
        </label>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>CSV columns: {cat.csvTemplate}</span>
      </div>
      {adding && <AddForm cat={cat} entities={entities} router={router} onDone={() => { setAdding(false); setMsg("Transaction added."); }} setErr={setErr} />}
    </div>
  );
}

function AddForm({ cat, entities, router, onDone, setErr }) {
  const [f, setF] = useState({ creditEntityId: "", debitEntityId: "", txn_date: "", currency: "GBP", gross_amount: "", net_amount: "", vat_amount: "", reference: "", invoice_number: "", supplier_name: "", nominal: "", payment_method: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const has = (c) => cat.cols.includes(c);
  async function submit() {
    setErr("");
    try {
      await api({ action: "create", category: cat.key, ...f,
        gross_amount: f.gross_amount === "" ? null : Number(f.gross_amount),
        net_amount: f.net_amount === "" ? null : Number(f.net_amount),
        vat_amount: f.vat_amount === "" ? null : Number(f.vat_amount) });
      onDone(); router.refresh();
    } catch (e) { setErr(e.message); }
  }
  const Sel = ({ k, ph }) => (
    <select style={input} value={f[k]} onChange={set(k)}>
      <option value="">{ph}</option>
      {entities.map((e) => <option key={e.entity_id} value={e.entity_id}>{e.entity_name}</option>)}
    </select>
  );
  return (
    <div style={{ marginTop: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, alignItems: "end" }}>
      <Field label="Credit entity (out)"><Sel k="creditEntityId" ph="Select…" /></Field>
      <Field label="Debit entity (in)"><Sel k="debitEntityId" ph="Select…" /></Field>
      <Field label="Date"><input type="date" style={input} value={f.txn_date} onChange={set("txn_date")} /></Field>
      <Field label={cat.amountLabel + " (£)"}><input type="number" style={input} value={f.gross_amount} onChange={set("gross_amount")} /></Field>
      {has("net_amount") && <Field label="Net (£)"><input type="number" style={input} value={f.net_amount} onChange={set("net_amount")} /></Field>}
      {has("vat_amount") && <Field label="VAT (£)"><input type="number" style={input} value={f.vat_amount} onChange={set("vat_amount")} /></Field>}
      {has("invoice_number") && <Field label="Invoice number"><input style={input} value={f.invoice_number} onChange={set("invoice_number")} /></Field>}
      {has("supplier_name") && <Field label="Supplier"><input style={input} value={f.supplier_name} onChange={set("supplier_name")} /></Field>}
      {has("nominal") && <Field label="Nominal"><input style={input} value={f.nominal} onChange={set("nominal")} /></Field>}
      {has("payment_method") && <Field label="Payment method"><input style={input} value={f.payment_method} onChange={set("payment_method")} /></Field>}
      <Field label="Reference"><input style={input} value={f.reference} onChange={set("reference")} /></Field>
      <button style={btn()} onClick={submit}>Add</button>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>{label}</label>{children}</div>;
}
