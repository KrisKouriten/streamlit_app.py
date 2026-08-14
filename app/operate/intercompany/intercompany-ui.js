"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { money } from "../../finance-os/ui";

const input = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13.5, width: "100%" };
const btn = (bg = "var(--accent)", fg = "#1a1813") => ({ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: bg, color: fg, fontSize: 13, fontWeight: 600, cursor: "pointer" });
const ghost = { height: 34, padding: "0 12px", background: "transparent", color: "var(--muted)", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 12.5, cursor: "pointer" };
const dateStr = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
// Year-month key from a date value, taken textually from the ISO string so it is
// timezone-independent and always matches the displayed month.
const ymKey = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 7) : "");
const ymLabel = (m) => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
const PAYMENT_METHODS = ["Bank", "Trade Pay"];

async function api(body) {
  const res = await fetch("/api/intercompany", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Action failed");
  return data;
}

export default function IntercompanyUI({ cats, entities, canManage }) {
  const router = useRouter();
  const [tab, setTab] = useState(cats[0].key);
  const [month, setMonth] = useState("all");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const cat = cats.find((c) => c.key === tab);

  // Month filter: distinct months in this ledger (newest first), and the rows /
  // summary for the selected month. Recomputed client-side so tiles focus too.
  const months = [...new Set(cat.txns.map((t) => ymKey(t.txn_date)).filter(Boolean))].sort().reverse();
  const filtered = month !== "all";
  const txns = filtered ? cat.txns.filter((t) => ymKey(t.txn_date) === month) : cat.txns;
  const view = {
    n: txns.length,
    total: txns.reduce((s, t) => s + (Number(t.gross_amount) || 0), 0),
    bs_reconciled: txns.filter((t) => t.recon_balance_sheet).length,
  };

  return (
    <div>
      {/* tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {cats.map((c) => {
          const on = c.key === tab;
          return (
            <button key={c.key} onClick={() => { setTab(c.key); setMonth("all"); setMsg(""); setErr(""); }} style={{
              fontSize: 12.5, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
              background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--muted)", fontWeight: on ? 700 : 500,
            }}>{c.label} <span style={{ opacity: 0.7 }}>· {c.summary.n}</span></button>
          );
        })}
      </div>

      {/* summary — reflects the selected month */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        <Tile label={filtered ? "Transactions · " + ymLabel(month) : "Transactions"} value={view.n} />
        <Tile label={filtered ? "Total value · " + ymLabel(month) : "Total value"} value={money(view.total, { compact: true })} />
        <Tile label="Balance-sheet reconciled" value={`${view.bs_reconciled} / ${view.n}`} tone={view.n && view.bs_reconciled === view.n ? "green" : view.bs_reconciled ? "amber" : undefined} />
      </div>

      {canManage && <Controls cat={cat} entities={entities} router={router} setMsg={setMsg} setErr={setErr} />}
      {msg && <div style={{ fontSize: 12.5, color: "var(--green)", margin: "8px 0" }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", margin: "8px 0", whiteSpace: "pre-wrap" }}>{err}</div>}

      {/* month filter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11.5, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...input, width: "auto", minWidth: 160 }}>
            <option value="all">All months</option>
            {months.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
          </select>
          {filtered && <button style={ghost} onClick={() => setMonth("all")}>Clear</button>}
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)" }}>Showing {txns.length} of {cat.txns.length}</div>
      </div>

      {/* table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
          <thead><tr>
            {["Date", "Credit (out) → Debit (in)", cat.amountLabel, cat.cols.includes("invoice_number") ? "Invoice" : null,
              cat.cols.includes("supplier_name") ? "Supplier" : null, "Reference", cat.cols.includes("payment_method") ? "Payment method" : null, "Reconciliation", canManage ? "" : null].filter((x) => x !== null).map((h, i) => (
              <th key={i} style={{ textAlign: i === 2 ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {txns.length === 0 && <tr><td colSpan={9} style={{ padding: "16px", color: "var(--faint)", fontSize: 13 }}>{cat.txns.length ? "No transactions in " + ymLabel(month) + "." : `No transactions yet. ${canManage ? "Add one or upload a CSV." : ""}`}</td></tr>}
            {txns.map((t) => (
              <TxnRow key={t.txn_id} t={t} cat={cat} entities={entities} canManage={canManage} router={router} setErr={setErr} />
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
      {adding && <TxnForm cat={cat} entities={entities} submitLabel="Add"
        onDone={() => { setAdding(false); setMsg("Transaction added."); router.refresh(); }}
        onCancel={() => setAdding(false)} setErr={setErr} />}
    </div>
  );
}

const miniBtn = { fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid var(--line-strong)", background: "transparent", color: "var(--muted)" };
const emptyForm = { creditEntityId: "", debitEntityId: "", txn_date: "", currency: "GBP", gross_amount: "", net_amount: "", vat_amount: "", reference: "", invoice_number: "", supplier_name: "", nominal: "", payment_method: "" };

// Map a stored transaction row back onto the editable form shape.
function txnToForm(t) {
  return {
    creditEntityId: t.credit_entity_id != null ? String(t.credit_entity_id) : "",
    debitEntityId: t.debit_entity_id != null ? String(t.debit_entity_id) : "",
    txn_date: t.txn_date ? String(t.txn_date).slice(0, 10) : "",
    currency: t.currency || "GBP",
    gross_amount: t.gross_amount ?? "",
    net_amount: t.net_amount ?? "",
    vat_amount: t.vat_amount ?? "",
    reference: t.reference || "",
    invoice_number: t.invoice_number || "",
    supplier_name: t.supplier_name || "",
    nominal: t.nominal || "",
    payment_method: t.payment_method || "",
  };
}

// One row of the ledger, plus its inline edit panel when editing.
function TxnRow({ t, cat, entities, canManage, router, setErr }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function del() {
    if (typeof window !== "undefined" && !window.confirm("Delete this transaction? This cannot be undone.")) return;
    setBusy(true); setErr("");
    try { await api({ action: "delete", txnId: t.txn_id }); router.refresh(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  const cell = { padding: "9px 12px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
  return (
    <>
      <tr>
        <td style={{ ...cell, color: "var(--muted)" }}>{dateStr(t.txn_date)}</td>
        <td style={cell}>
          <span style={{ fontWeight: 560 }}>{t.credit_name || "?"}</span> <span style={{ color: "var(--faint)" }}>→</span> <span style={{ fontWeight: 560 }}>{t.debit_name || "?"}</span>
        </td>
        <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(t.gross_amount)}</td>
        {cat.cols.includes("invoice_number") && <td style={{ ...cell, color: "var(--muted)" }}>{t.invoice_number || "—"}</td>}
        {cat.cols.includes("supplier_name") && <td style={{ ...cell, color: "var(--muted)" }}>{t.supplier_name || "—"}</td>}
        <td style={{ ...cell, color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 11.5 }}>{t.reference || "—"}</td>
        {cat.cols.includes("payment_method") && <td style={{ ...cell, color: "var(--muted)" }}>{t.payment_method || "—"}</td>}
        <td style={cell}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {cat.recon.map(([flag, label]) => (
              <ReconChip key={flag} txnId={t.txn_id} flag={flag} label={label} value={t[flag]} canManage={canManage} router={router} setErr={setErr} />
            ))}
          </div>
        </td>
        {canManage && (
          <td style={cell}>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={editing ? { ...miniBtn, borderColor: "var(--accent)", color: "var(--accent)" } : miniBtn} onClick={() => setEditing((x) => !x)}>{editing ? "Close" : "Edit"}</button>
              <button style={{ ...miniBtn, color: "var(--red)", borderColor: "var(--line-strong)" }} onClick={del} disabled={busy}>Delete</button>
            </div>
          </td>
        )}
      </tr>
      {editing && (
        <tr>
          <td colSpan={9} style={{ padding: "0 12px 14px", borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
            <TxnForm cat={cat} entities={entities} initial={txnToForm(t)} mode="update" txnId={t.txn_id} submitLabel="Save changes"
              onDone={() => { setEditing(false); router.refresh(); }} onCancel={() => setEditing(false)} setErr={setErr} />
          </td>
        </tr>
      )}
    </>
  );
}

// Shared add/edit form. mode "create" or "update"; on update, txnId is sent.
function TxnForm({ cat, entities, initial, mode = "create", txnId, submitLabel = "Add", onDone, onCancel, setErr }) {
  const [f, setF] = useState(initial || emptyForm);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const has = (c) => cat.cols.includes(c);
  async function submit() {
    setErr(""); setBusy(true);
    try {
      await api({ action: mode, category: cat.key, txnId, ...f,
        creditEntityId: f.creditEntityId === "" ? null : Number(f.creditEntityId),
        debitEntityId: f.debitEntityId === "" ? null : Number(f.debitEntityId),
        gross_amount: f.gross_amount === "" ? null : Number(f.gross_amount),
        net_amount: f.net_amount === "" ? null : Number(f.net_amount),
        vat_amount: f.vat_amount === "" ? null : Number(f.vat_amount) });
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
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
      {has("payment_method") && <Field label="Payment method">
        <select style={input} value={f.payment_method || ""} onChange={set("payment_method")}>
          <option value="">Select…</option>
          {(f.payment_method && !PAYMENT_METHODS.includes(f.payment_method) ? [f.payment_method, ...PAYMENT_METHODS] : PAYMENT_METHODS).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>}
      <Field label="Reference"><input style={input} value={f.reference} onChange={set("reference")} /></Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn()} onClick={submit} disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button style={ghost} onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>{label}</label>{children}</div>;
}
