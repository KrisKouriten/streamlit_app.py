"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cardSpendTotals } from "../../../lib/card-spend-rules";
import DateField from "../../finance-os/date-field";
import MoneyInput from "../../money-input";

/* Card / pre-approved spend — client. A log of spend already made on a company
   card (or pre-approved) assigned to a Departmental Budget (Business or Project).
   Mirrors the Miscellaneous Spend form (add-a-line + list) but keyed on a supplier
   rather than a category, and reports as committed spend. House style: inline
   styles on CSS vars. Posts to /api/card-spend. */

const money = (v) => `£${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

// "Marketing · Business · 2026" / "Property · Project · IGB Leeds · 2026"
const budgetLabel = (b) =>
  `${b.department} · ${b.type === "PROJECT" ? `Project${b.project ? ` · ${b.project}` : ""}` : "Business"} · ${b.year}`;

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 18 };
const field = { display: "flex", flexDirection: "column", gap: 5 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "9px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", verticalAlign: "top" };

const EMPTY = { spend_date: "", department: "", budget_id: "", supplier: "", amount: "", description: "", notes: "" };

export default function CardSpendUI({ initialRows, budgets = [], departments = [], me }) {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editId, setEditId] = useState(null);   // card_id being edited
  const [filterBudget, setFilterBudget] = useState("");

  const rows = initialRows || [];
  const totals = useMemo(() => cardSpendTotals(rows), [rows]);

  // Departments that actually have a budget (so the picker never dead-ends).
  const deptsWithBudget = useMemo(() => {
    const set = new Set(budgets.map((b) => b.department));
    return departments.filter((d) => set.has(d));
  }, [budgets, departments]);
  // Budgets for the chosen department.
  const budgetsForDept = useMemo(() => budgets.filter((b) => b.department === f.department), [budgets, f.department]);

  async function post(body, note) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch("/api/card-spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (note) setMsg(note);
      router.refresh();
      return j;
    } catch (e) { setError(e.message); return null; }
    finally { setBusy(false); }
  }

  async function submit() {
    const body = {
      spend_date: f.spend_date || null, supplier: f.supplier, amount: f.amount === "" ? null : Number(f.amount),
      budget_id: f.budget_id ? Number(f.budget_id) : null, description: f.description || null, notes: f.notes || null,
    };
    if (editId) {
      const j = await post({ op: "update", card_id: editId, patch: body }, "Entry updated.");
      if (j) { setEditId(null); setF(EMPTY); }
    } else {
      const j = await post(body, "Spend logged.");
      if (j) setF({ ...EMPTY, department: f.department, budget_id: f.budget_id });  // keep the budget for rapid entry
    }
  }

  function beginEdit(r) {
    setEditId(r.card_id);
    setF({
      spend_date: r.spend_date ? new Date(r.spend_date).toISOString().slice(0, 10) : "",
      department: r.department || "", budget_id: r.budget_id ? String(r.budget_id) : "",
      supplier: r.supplier || "", amount: r.amount == null ? "" : String(r.amount),
      description: r.description || "", notes: r.notes || "",
    });
    setMsg(null); setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelEdit() { setEditId(null); setF(EMPTY); }
  function del(r) {
    if (!window.confirm(`Delete this ${r.supplier} entry (${money(r.amount)})? This cannot be undone.`)) return;
    post({ op: "delete", card_id: r.card_id }, "Entry deleted.");
  }

  const shown = filterBudget ? rows.filter((r) => String(r.budget_id) === filterBudget) : rows;
  const canSubmit = f.supplier && f.budget_id && Number(f.amount) > 0;

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, maxWidth: 720, lineHeight: 1.5 }}>
        Log spend already made on a company card, or otherwise pre-approved, that doesn&rsquo;t go through the P.O + sign-off flow. It reports as <strong>committed spend</strong> against the assigned budget on the Department Dashboard — no P.O number, no sign-off.
      </div>

      {/* summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 18 }}>
        <div className="fos-card" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Logged total</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="fos-num">{money(totals.total)}</div>
        </div>
        <div className="fos-card" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Entries</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="fos-num">{totals.count}</div>
        </div>
      </div>

      {/* add / edit form */}
      <div style={{ ...card, ...(editId ? { border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--line))", background: "var(--accent-bg)" } : {}) }}>
        <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 12 }}>{editId ? "Edit spend entry" : "Log Card / Pre-approved Spend"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <label style={field}><span style={labelSt}>Date</span><DateField value={f.spend_date} onChange={(iso) => setF((s) => ({ ...s, spend_date: iso }))} /></label>
          <label style={field}><span style={labelSt}>Department *</span>
            <select style={inputSt} value={f.department} onChange={(e) => setF((s) => ({ ...s, department: e.target.value, budget_id: "" }))}>
              <option value="">— choose department —</option>
              {deptsWithBudget.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label style={field}><span style={labelSt}>Budget *</span>
            <select style={inputSt} value={f.budget_id} onChange={(e) => setF((s) => ({ ...s, budget_id: e.target.value }))} disabled={!f.department}>
              <option value="">{!f.department ? "— choose a department first —" : budgetsForDept.length ? "— choose budget —" : "No budgets — create in Departmental Budgets"}</option>
              {budgetsForDept.map((b) => <option key={b.id} value={b.id}>{b.type === "PROJECT" ? `Project${b.project ? ` · ${b.project}` : ""}` : "Business (annual)"} · {b.year} · {b.version}</option>)}
            </select>
          </label>
          <label style={field}><span style={labelSt}>Supplier *</span><input style={inputSt} value={f.supplier} onChange={(e) => setF((s) => ({ ...s, supplier: e.target.value }))} placeholder="e.g. Amazon, Canva, Uber" /></label>
          <label style={field}><span style={labelSt}>Amount (£) *</span><MoneyInput style={{ ...inputSt, textAlign: "right" }} className="fos-num" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} placeholder="e.g. 45.00" /></label>
          <label style={field}><span style={labelSt}>Description</span><input style={inputSt} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} placeholder="e.g. Software subscription, event supplies…" /></label>
          <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Notes</span><input style={inputSt} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></label>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button style={{ ...btn("var(--accent)"), opacity: canSubmit ? 1 : 0.5 }} disabled={busy || !canSubmit} onClick={submit}>{busy ? "Saving…" : editId ? "Save changes" : "Log spend"}</button>
          {editId && <button style={ghost} onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>

      {/* list */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 650 }}>Logged spend <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {shown.length}</span></div>
          <select style={{ ...inputSt, maxWidth: 320 }} value={filterBudget} onChange={(e) => setFilterBudget(e.target.value)}>
            <option value="">All budgets</option>
            {budgets.map((b) => <option key={b.id} value={b.id}>{budgetLabel(b)}</option>)}
          </select>
        </div>
        {!shown.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No spend logged yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
              <thead><tr>
                <th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>Description</th><th style={th}>Budget</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th><th style={{ ...th, textAlign: "right" }}></th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.card_id}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontFamily: "var(--mono)", fontSize: 12 }}>{dmy(r.spend_date)}</td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{r.supplier}</td>
                    <td style={{ ...td, color: "var(--muted)", whiteSpace: "normal", maxWidth: 260 }}>{r.description || "—"}{r.notes ? <div style={{ fontSize: 11, color: "var(--faint)" }}>{r.notes}</div> : null}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12 }}>
                      {r.department || "—"}
                      <div style={{ fontSize: 10.5, color: r.budget_type === "PROJECT" ? "var(--accent)" : "var(--faint)", fontFamily: "var(--mono)" }}>
                        {r.budget_id ? (r.budget_type === "PROJECT" ? `◆ Project${r.project_name ? ` · ${r.project_name}` : ""}` : "Business") + ` · ${r.budget_year ?? ""}` : "budget removed"}
                      </div>
                    </td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{money(r.amount)}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button style={{ ...ghost, padding: "5px 10px", marginRight: 6 }} onClick={() => beginEdit(r)}>Edit</button>
                      <button style={{ ...ghost, padding: "5px 10px", color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} onClick={() => del(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
