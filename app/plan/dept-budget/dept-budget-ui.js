"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MONTHS, MONTH_KEYS, lineTotal, monthlyTotals, grandTotal, priorYearTotal,
  categoryGroups, variance,
} from "../../../lib/dept-budget-rules";

/* Departmental Budgets — the editor. Left: pick/create a budget. Right: the
   cost-line grid (categories × 12 months) with prior-year comparison, per-line
   equal-split, category subtotals, monthly column totals and a grand total.
   A DRAFT can be edited and submitted; approvers sign it off; reopen to edit. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 18 };
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const inputSt = { fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 14px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const cellIn = { width: 66, fontSize: 12, padding: "4px 5px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", textAlign: "right" };
const th = { fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--faint)", padding: "6px 6px", textAlign: "right", whiteSpace: "nowrap" };
const td = { padding: "3px 6px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap" };
const STATUS_TONE = { DRAFT: "var(--muted)", SUBMITTED: "var(--amber)", APPROVED: "var(--green)" };
const money0 = (v) => `£${Math.round(Number(v) || 0).toLocaleString("en-GB")}`;

export default function DeptBudgetUI({ initialBudgets, departments, myDept, isAdminFinance, me }) {
  const router = useRouter();
  const keyRef = useRef(1);
  const thisYear = new Date().getFullYear();

  const editableDepts = isAdminFinance ? departments : departments.filter((d) => d === myDept);
  const [budgets] = useState(initialBudgets);
  const [selId, setSelId] = useState(null);
  const [loaded, setLoaded] = useState(null); // { budget, canEdit, canApprove, approvers }
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  // Create form
  const [nd, setNd] = useState(editableDepts[0] || "");
  const [nyear, setNyear] = useState(thisYear);
  const [nver, setNver] = useState("");

  const editing = loaded?.canEdit && loaded?.budget?.status === "DRAFT";
  const groups = useMemo(() => categoryGroups(lines), [lines]);
  const monthly = useMemo(() => monthlyTotals(lines), [lines]);
  const gTotal = useMemo(() => grandTotal(lines), [lines]);
  const pyTotal = useMemo(() => priorYearTotal(lines), [lines]);
  const gVar = variance(gTotal, pyTotal);

  function withKeys(rows) {
    return rows.map((r) => ({ _key: keyRef.current++, ...r }));
  }

  async function api(body) {
    setError(null); setMsg(null); setBusy(true);
    const res = await fetch("/api/plan/dept-budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error || "Action failed"); return null; }
    return j;
  }

  async function loadBudget(id) {
    setError(null); setMsg(null);
    const res = await fetch(`/api/plan/dept-budget?id=${id}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error || "Could not load budget"); return; }
    setSelId(id);
    setLoaded({ budget: j.budget, canEdit: j.canEdit, canApprove: j.canApprove, approvers: j.approvers || [] });
    setLines(withKeys(j.lines || []));
    setDirty(false);
  }

  async function createBudget() {
    if (!nd) { setError("Choose a department"); return; }
    const r = await api({ action: "create", department: nd, budget_year: Number(nyear), version_label: nver });
    if (r) { setNver(""); await loadBudget(r.budgetId); router.refresh(); }
  }

  function updCell(key, field, value) {
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, [field]: value } : l)));
    setDirty(true);
  }
  function addLine(category) {
    setLines((ls) => [...ls, { _key: keyRef.current++, category, line_label: "", prior_year: 0, ...Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])) }]);
    setDirty(true);
  }
  function addCategory() {
    const name = window.prompt("New category name");
    if (!name || !name.trim()) return;
    addLine(name.trim());
  }
  function removeLine(key) {
    setLines((ls) => ls.filter((l) => l._key !== key));
    setDirty(true);
  }
  function spread(key) {
    const line = lines.find((l) => l._key === key);
    const raw = window.prompt("Spread what full-year amount evenly across the 12 months?", String(lineTotal(line)));
    if (raw == null) return;
    const annual = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(annual)) { setError("Enter a number to spread"); return; }
    // equalSplit lives in the rules; recompute inline to keep months summing exactly.
    const cents = Math.round(annual * 100);
    const base = Math.trunc(cents / 12);
    let rem = cents - base * 12; const step = rem < 0 ? -1 : 1; rem = Math.abs(rem);
    const vals = MONTH_KEYS.map((_, i) => Math.round((base + (i < rem ? step : 0))) / 100);
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, ...Object.fromEntries(MONTH_KEYS.map((k, i) => [k, vals[i]])) } : l)));
    setDirty(true);
  }

  async function save() {
    const payload = lines.map((l, i) => ({
      category: l.category || "General", line_label: l.line_label, sort_order: i * 10,
      prior_year: Number(l.prior_year) || 0,
      ...Object.fromEntries(MONTH_KEYS.map((k) => [k, Number(l[k]) || 0])),
    }));
    if (payload.some((l) => !String(l.line_label).trim())) { setError("Every cost line needs a name"); return; }
    const r = await api({ action: "save-lines", budgetId: selId, lines: payload });
    if (r) { setDirty(false); setMsg("Saved."); }
  }
  async function doAction(action) {
    if (dirty && action === "submit") { setError("Save your changes before submitting"); return; }
    if (action === "delete" && !window.confirm("Delete this budget version? This cannot be undone.")) return;
    const r = await api({ action, budgetId: selId });
    if (!r) return;
    if (action === "delete") { setSelId(null); setLoaded(null); setLines([]); router.refresh(); return; }
    await loadBudget(selId); router.refresh();
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18, alignItems: "start" }}>
      {/* Left column — create + pick */}
      <div>
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 10 }}>New budget</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Department</span>
              <select value={nd} onChange={(e) => setNd(e.target.value)} style={inputSt} disabled={!editableDepts.length}>
                {editableDepts.length ? editableDepts.map((d) => <option key={d} value={d}>{d}</option>) : <option>No department assigned</option>}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Budget year</span>
              <input type="number" value={nyear} onChange={(e) => setNyear(e.target.value)} style={inputSt} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={labelSt}>Version label</span>
              <input value={nver} onChange={(e) => setNver(e.target.value)} placeholder="Working draft" style={inputSt} />
            </label>
            <button onClick={createBudget} disabled={busy || !editableDepts.length} style={btn("var(--accent)")}>Create from template</button>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 650, marginBottom: 10 }}>Budgets</div>
          {!budgets.length && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>None yet — create one above.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {budgets.map((b) => (
              <button key={b.budget_id} onClick={() => loadBudget(b.budget_id)}
                style={{ textAlign: "left", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                  border: `1px solid ${selId === b.budget_id ? "var(--accent)" : "var(--line)"}`,
                  background: selId === b.budget_id ? "var(--accent-bg)" : "transparent" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.department} · {b.budget_year}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                  <span>{b.version_label}</span>
                  <span style={{ color: STATUS_TONE[b.status] || "var(--muted)", fontWeight: 600 }}>{b.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right column — the grid */}
      <div>
        {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

        {!loaded ? (
          <div style={{ ...card, color: "var(--faint)", fontSize: 13 }}>Pick a budget on the left, or create one, to start building.</div>
        ) : (
          <>
            <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 650 }}>{loaded.budget.department} — {loaded.budget.budget_year}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {loaded.budget.version_label} · <span style={{ color: STATUS_TONE[loaded.budget.status], fontWeight: 600 }}>{loaded.budget.status}</span>
                  {loaded.budget.approved_by && <> · signed off by {loaded.budget.approved_by}</>}
                </div>
                {!!loaded.approvers.length && (
                  <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>Sign-off: {loaded.approvers.join(", ")}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {editing && <button onClick={save} disabled={busy || !dirty} style={btn(dirty ? "var(--accent)" : "var(--line)", dirty ? "#fff" : "var(--faint)")}>Save</button>}
                {editing && <button onClick={() => doAction("submit")} disabled={busy} style={ghost}>Submit for sign-off</button>}
                {loaded.budget.status === "SUBMITTED" && loaded.canApprove && <button onClick={() => doAction("approve")} disabled={busy} style={btn("var(--green)")}>Approve</button>}
                {loaded.budget.status !== "DRAFT" && loaded.canEdit && <button onClick={() => doAction("reopen")} disabled={busy} style={ghost}>Reopen</button>}
                {loaded.canEdit && <button onClick={() => doAction("delete")} disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "var(--red)" }}>Delete</button>}
              </div>
            </div>

            {!editing && loaded.budget.status !== "DRAFT" && (
              <div style={{ fontSize: 12, color: "var(--faint)", margin: "-6px 0 10px" }}>This budget is {loaded.budget.status.toLowerCase()} and read-only. {loaded.canEdit ? "Reopen it to edit." : ""}</div>
            )}

            <div style={{ ...card, padding: 0, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1080 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)", minWidth: 190 }}>Cost line</th>
                    {MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}
                    <th style={{ ...th, color: "var(--ink)" }}>FY total</th>
                    <th style={th}>Prior yr</th>
                    <th style={th}>vs PY</th>
                    {editing && <th style={th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <CategoryBand key={g.category} group={g} lines={lines} editing={editing}
                      updCell={updCell} removeLine={removeLine} spread={spread} addLine={addLine} />
                  ))}
                  {/* Grand total */}
                  <tr style={{ borderTop: "2px solid var(--line)", background: "var(--raise)" }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700, position: "sticky", left: 0, background: "var(--raise)" }}>Grand total</td>
                    {monthly.map((v, i) => <td key={i} style={{ ...td, fontWeight: 600 }}>{money0(v)}</td>)}
                    <td style={{ ...td, fontWeight: 800 }}>{money0(gTotal)}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{money0(pyTotal)}</td>
                    <td style={{ ...td, color: gVar.abs > 0 ? "var(--amber)" : "var(--green)", fontWeight: 600 }}>
                      {gVar.abs >= 0 ? "+" : ""}{money0(gVar.abs)}{gVar.pct != null ? ` (${gVar.pct >= 0 ? "+" : ""}${gVar.pct}%)` : ""}
                    </td>
                    {editing && <td style={td}></td>}
                  </tr>
                </tbody>
              </table>
            </div>

            {editing && (
              <button onClick={addCategory} style={{ ...ghost, marginTop: -6 }}>+ Add category</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CategoryBand({ group, lines, editing, updCell, removeLine, spread, addLine }) {
  const gVar = variance(group.subtotal, group.prior);
  return (
    <>
      <tr style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
        <td colSpan={editing ? 17 : 16} style={{ ...td, textAlign: "left", fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent)", padding: "7px 6px", position: "sticky", left: 0 }}>
          {group.category}
        </td>
      </tr>
      {group.lines.map((line) => {
        const total = lineTotal(line);
        const v = variance(total, line.prior_year);
        return (
          <tr key={line._key} style={{ borderBottom: "1px solid var(--hairline)" }}>
            <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--surface)" }}>
              {editing
                ? <input value={line.line_label} onChange={(e) => updCell(line._key, "line_label", e.target.value)} placeholder="Cost line" style={{ ...inputSt, width: 176, padding: "4px 7px", fontSize: 12 }} />
                : <span style={{ fontSize: 12.5 }}>{line.line_label}</span>}
            </td>
            {MONTH_KEYS.map((k) => (
              <td key={k} style={{ ...td, padding: "2px 3px" }}>
                {editing
                  ? <input value={line[k] === 0 ? "" : line[k]} onChange={(e) => updCell(line._key, k, e.target.value)} style={cellIn} inputMode="decimal" />
                  : <span>{Number(line[k]) ? money0(line[k]) : "—"}</span>}
              </td>
            ))}
            <td style={{ ...td, fontWeight: 700 }}>{money0(total)}</td>
            <td style={{ ...td, padding: "2px 3px" }}>
              {editing
                ? <input value={line.prior_year === 0 ? "" : line.prior_year} onChange={(e) => updCell(line._key, "prior_year", e.target.value)} style={cellIn} inputMode="decimal" />
                : <span style={{ color: "var(--muted)" }}>{Number(line.prior_year) ? money0(line.prior_year) : "—"}</span>}
            </td>
            <td style={{ ...td, color: v.abs > 0 ? "var(--amber)" : "var(--green)" }}>{v.pct != null ? `${v.pct >= 0 ? "+" : ""}${v.pct}%` : "—"}</td>
            {editing && (
              <td style={{ ...td, padding: "2px 4px" }}>
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <button title="Spread a full-year amount evenly" onClick={() => spread(line._key)} style={{ ...ghost, padding: "2px 7px" }}>≡</button>
                  <button title="Remove line" onClick={() => removeLine(line._key)} style={{ ...ghost, padding: "2px 7px", color: "var(--red)" }}>×</button>
                </span>
              </td>
            )}
          </tr>
        );
      })}
      <tr style={{ borderBottom: "1px solid var(--line)" }}>
        <td style={{ ...td, textAlign: "left", fontSize: 11.5, color: "var(--muted)", fontStyle: "italic", position: "sticky", left: 0, background: "var(--surface)" }}>
          {group.category} subtotal
          {editing && <button onClick={() => addLine(group.category)} style={{ ...ghost, padding: "1px 7px", marginLeft: 8, fontStyle: "normal" }}>+ line</button>}
        </td>
        {group.monthly.map((v, i) => <td key={i} style={{ ...td, fontSize: 11.5, color: "var(--muted)" }}>{money0(v)}</td>)}
        <td style={{ ...td, fontWeight: 700 }}>{money0(group.subtotal)}</td>
        <td style={{ ...td, color: "var(--faint)" }}>{money0(group.prior)}</td>
        <td style={{ ...td, color: "var(--faint)" }}>{gVar.pct != null ? `${gVar.pct >= 0 ? "+" : ""}${gVar.pct}%` : "—"}</td>
        {editing && <td style={td}></td>}
      </tr>
    </>
  );
}
