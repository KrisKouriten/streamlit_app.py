"use client";
import { useState } from "react";

/*
 * SupplierPicker — a supplier dropdown that lets the person raising a request add
 * a supplier inline when it isn't yet on the master. Used on the Purchase Order
 * request form and the Procurement request forms.
 *
 * Choosing "＋ Add new supplier…" reveals a name field; on Add it POSTs
 * { op: "propose" } to /api/suppliers, which creates a stub supplier (flagged for
 * Finance to complete on Suppliers & Credit) and returns it. The new name is then
 * merged into the list and selected — no page refresh, so the half-filled form is
 * preserved. Typing a name that already exists simply selects it.
 *
 * Props:
 *   options    array of supplier names, or objects with a `.name`
 *   value      currently selected name
 *   onChange   (name) => void
 *   selectStyle style applied to the <select> / name input (match the host form)
 *   placeholder placeholder option text
 *   required   mark the select required
 *   disabled   disable the control
 *   hintColor  colour for the confirmation hint (default faint)
 */
const ADD = "__add_new_supplier__";

export default function SupplierPicker({
  options = [], value = "", onChange, selectStyle,
  placeholder = "— choose supplier —", required = false, disabled = false,
  hintColor = "var(--faint)",
}) {
  const names = options.map((o) => (typeof o === "string" ? o : o && o.name)).filter(Boolean);
  const [added, setAdded] = useState([]);   // proposed during this session (not yet on the server list)
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  // Merge server names + session adds + the current value, de-duped case-insensitively.
  const all = [];
  const seen = new Set();
  for (const n of [...names, ...added, ...(value ? [value] : [])]) {
    const k = String(n).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); all.push(n);
  }
  all.sort((a, b) => String(a).localeCompare(String(b)));

  async function propose() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "propose", name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not add the supplier");
      const finalName = j.name || name;
      setAdded((s) => (s.some((x) => x.toLowerCase() === finalName.toLowerCase()) ? s : [...s, finalName]));
      onChange && onChange(finalName);
      setNote(j.existed
        ? `“${finalName}” is already on the list — selected.`
        : `“${finalName}” added — Finance will complete its credit details.`);
      setAdding(false); setDraft("");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function onSelect(e) {
    const v = e.target.value;
    if (v === ADD) { setAdding(true); setNote(null); setErr(null); return; }
    onChange && onChange(v);
  }

  const btn = { height: 32, fontSize: 12.5, fontWeight: 650, padding: "0 12px", borderRadius: 6, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", cursor: "pointer", whiteSpace: "nowrap" };
  const cancel = { height: 32, fontSize: 12.5, fontWeight: 500, padding: "0 10px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {!adding ? (
        <select style={selectStyle} value={value || ""} onChange={onSelect} required={required} disabled={disabled}>
          <option value="">{placeholder}</option>
          {all.map((n) => <option key={n} value={n}>{n}</option>)}
          <option value={ADD}>＋ Add new supplier…</option>
        </select>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "stretch", flexWrap: "wrap" }}>
          <input autoFocus style={{ ...selectStyle, flex: "1 1 130px" }} value={draft}
            onChange={(e) => setDraft(e.target.value)} placeholder="New supplier name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); propose(); } }} />
          <button type="button" onClick={propose} disabled={busy || !draft.trim()} style={{ ...btn, opacity: busy || !draft.trim() ? 0.5 : 1 }}>{busy ? "Adding…" : "Add"}</button>
          <button type="button" onClick={() => { setAdding(false); setDraft(""); setErr(null); }} style={cancel}>Cancel</button>
        </div>
      )}
      {err && <span style={{ fontSize: 11, color: "var(--red)" }}>{err}</span>}
      {note && <span style={{ fontSize: 10.5, color: hintColor }}>{note}</span>}
    </div>
  );
}
