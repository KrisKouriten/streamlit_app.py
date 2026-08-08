"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { summariseProjectCosts } from "../../../../lib/business-projects-rules";
import MoneyInput from "../../../money-input";

/* Business Project drill-down — client. Presents per-department PLANNED costs
   (finance.business_project_cost) against ACTUAL P.O spend (POs tagged to this
   project), and lets any signed-in user add / edit / delete planned cost lines.
   Actual comes from the P.O Requests screen — read-only here. All merge maths is
   pure (lib/business-projects-rules → summariseProjectCosts); this file presents
   and posts to /api/business-projects (op cost-upsert / cost-delete). House
   style: inline styles on CSS variables, no framework. */

const gbp = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `£${Math.round(Number(v)).toLocaleString("en-GB")}`);

export default function ProjectDetailUI({ project, costs, actuals }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const [showNew, setShowNew] = useState(false);
  const [nc, setNc] = useState({ department: "", cost_line: "", amount: "", notes: "" });

  const { byDept, totals } = summariseProjectCosts(costs, actuals, project.budget);

  // One POST helper (mirrors capex-ui): on !ok surface {error}; on ok refresh.
  async function post(body, note) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch("/api/business-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Action failed");
      if (note) setMsg(note);
      router.refresh();
      return true;
    } catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  }

  async function addCost() {
    if (!(await post({ op: "cost-upsert", business_project_id: project.id, department: nc.department, cost_line: nc.cost_line, amount: nc.amount, notes: nc.notes }, "Cost line added."))) return;
    setNc({ department: "", cost_line: "", amount: "", notes: "" });
    setShowNew(false);
  }
  function deleteCost(c) {
    if (!window.confirm(`Delete cost line "${c.cost_line || c.department || "—"}"? This cannot be undone.`)) return;
    post({ op: "cost-delete", cost_id: c.cost_id }, "Cost line deleted.");
  }

  const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 };
  const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
  const field = { display: "flex", flexDirection: "column", gap: 5 };
  const inputSt = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
  const btn = (bg, fg = "#fff") => ({ fontSize: 13, fontWeight: 650, padding: "8px 16px", borderRadius: 9, border: `1px solid ${bg}`, background: bg, color: fg, cursor: "pointer" });
  const ghost = { fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
  const th = { textAlign: "left", padding: "8px 10px", ...labelSt, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" };
  const vTone = (v) => (v == null ? "var(--ink)" : Number(v) < 0 ? "var(--red)" : "var(--ink)");

  const RAG_COLOR = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };

  function Kpi({ label, value, tone }) {
    return (
      <div className="fos-card" style={{ padding: "14px 16px" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>{label}</div>
        <div className="fos-num" style={{ fontSize: 23, fontWeight: 650, lineHeight: 1, letterSpacing: "-.02em", color: tone || "var(--ink)" }}>{value}</div>
      </div>
    );
  }

  return (
    <div>
      {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* Project header line */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 650, display: "flex", alignItems: "center", gap: 10 }}>
            {project.name}
            <span style={{ color: RAG_COLOR[project.rag] || "var(--muted)", fontWeight: 700 }} title={`RAG: ${project.rag}`}>●</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 3 }}>
            {project.status}{project.category ? ` · ${project.category}` : ""}{project.owner ? ` · ${project.owner}` : ""}{project.target_ym ? ` · target ${project.target_ym}` : ""}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
        <Kpi label="Budget" value={gbp(totals.budget)} />
        <Kpi label="Planned" value={gbp(totals.planned)} />
        <Kpi label="Actual (P.O spend)" value={gbp(totals.actual)} />
        <Kpi label="Variance" value={gbp(totals.variance)} tone={vTone(totals.variance)} />
      </div>

      {/* Per-department table */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>Planned vs actual by department</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12 }}>Variance = planned − actual. A negative (red) variance means the department has overspent its plan.</div>
        {!byDept.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No planned costs or tagged P.O spend yet. Add a cost line below.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
              <thead><tr>
                <th style={th}>Department</th>
                {["Planned", "Actual (P.O)", "Variance"].map((h) => <th key={h} style={{ ...th, textAlign: "right" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {byDept.map((d) => (
                  <tr key={d.department}>
                    <td style={{ ...td, fontWeight: 600 }}>{d.department}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{gbp(d.planned)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right" }}>{gbp(d.actual)}</td>
                    <td className="fos-num" style={{ ...td, textAlign: "right", color: vTone(d.variance) }}>{gbp(d.variance)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>Total</td>
                  <td className="fos-num" style={{ ...td, textAlign: "right", fontWeight: 700, borderBottom: "none" }}>{gbp(totals.planned)}</td>
                  <td className="fos-num" style={{ ...td, textAlign: "right", fontWeight: 700, borderBottom: "none" }}>{gbp(totals.actual)}</td>
                  <td className="fos-num" style={{ ...td, textAlign: "right", fontWeight: 700, borderBottom: "none", color: vTone(totals.variance) }}>{gbp(totals.variance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10, lineHeight: 1.5 }}>
          Actual spend comes from Purchase Orders tagged to this project on the <strong>P.O Requests</strong> screen — it is read-only here.
        </div>
      </div>

      {/* Cost lines editor */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 650 }}>Cost lines <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>· {costs.length} planned</span></div>
          <button style={ghost} onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "+ Add cost line"}</button>
        </div>

        {showNew && (
          <div style={{ padding: "14px 16px", marginBottom: 14, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--line))", background: "var(--accent-bg)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <label style={field}><span style={labelSt}>Department</span><input style={inputSt} value={nc.department} onChange={(e) => setNc({ ...nc, department: e.target.value })} placeholder="e.g. Marketing" /></label>
              <label style={field}><span style={labelSt}>Cost line</span><input style={inputSt} value={nc.cost_line} onChange={(e) => setNc({ ...nc, cost_line: e.target.value })} placeholder="e.g. Agency retainer" /></label>
              <label style={field}><span style={labelSt}>Amount £</span><MoneyInput style={inputSt} value={nc.amount} onChange={(e) => setNc({ ...nc, amount: e.target.value })} /></label>
              <label style={{ ...field, gridColumn: "1 / -1" }}><span style={labelSt}>Notes</span><input style={inputSt} value={nc.notes} onChange={(e) => setNc({ ...nc, notes: e.target.value })} /></label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button style={btn("var(--accent)")} disabled={busy} onClick={addCost}>{busy ? "Working…" : "Add cost line"}</button>
              <button style={ghost} onClick={() => { setShowNew(false); setNc({ department: "", cost_line: "", amount: "", notes: "" }); }}>Cancel</button>
            </div>
          </div>
        )}

        {!costs.length ? (
          <div style={{ fontSize: 13, color: "var(--faint)" }}>No planned cost lines yet. Add one above to build the plan.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead><tr>
                <th style={th}>Department</th>
                <th style={th}>Cost line</th>
                <th style={{ ...th, textAlign: "right" }}>Amount £</th>
                <th style={th}>Notes</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {costs.map((c) => <CostRow key={c.cost_id} c={c} project={project} post={post} busy={busy} deleteCost={deleteCost} styles={{ td, inputSt, ghost, btn }} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// One editable/deletable cost-line row. Edits post op cost-upsert with the id.
function CostRow({ c, project, post, busy, deleteCost, styles }) {
  const { td, inputSt, ghost, btn } = styles;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ department: c.department || "", cost_line: c.cost_line || "", amount: c.amount == null ? "" : String(c.amount), notes: c.notes || "" });

  async function save() {
    if (await post({ op: "cost-upsert", id: c.cost_id, business_project_id: project.id, department: f.department, cost_line: f.cost_line, amount: f.amount, notes: f.notes }, "Cost line updated.")) setEdit(false);
  }

  if (edit) {
    return (
      <tr>
        <td style={td}><input style={{ ...inputSt, width: "100%" }} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></td>
        <td style={td}><input style={{ ...inputSt, width: "100%" }} value={f.cost_line} onChange={(e) => setF({ ...f, cost_line: e.target.value })} /></td>
        <td style={{ ...td, textAlign: "right" }}><MoneyInput style={{ ...inputSt, width: 120, textAlign: "right" }} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></td>
        <td style={td}><input style={{ ...inputSt, width: "100%" }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></td>
        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
          <button style={{ ...btn("var(--accent)"), padding: "4px 10px" }} disabled={busy} onClick={save}>Save</button>{" "}
          <button style={{ ...ghost, padding: "4px 10px" }} onClick={() => setEdit(false)}>Cancel</button>
        </td>
      </tr>
    );
  }
  const gbp = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : `£${Math.round(Number(v)).toLocaleString("en-GB")}`);
  return (
    <tr>
      <td style={{ ...td, fontWeight: 600 }}>{c.department || "Unassigned"}</td>
      <td style={td}>{c.cost_line || "—"}</td>
      <td className="fos-num" style={{ ...td, textAlign: "right" }}>{gbp(c.amount)}</td>
      <td style={{ ...td, color: "var(--muted)", whiteSpace: "normal", maxWidth: 280 }}>{c.notes || "—"}</td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        <button style={{ ...ghost, padding: "4px 10px" }} onClick={() => setEdit(true)}>Edit</button>{" "}
        <button title="Delete cost line" style={{ ...ghost, padding: "4px 9px", color: "var(--red)", borderColor: "color-mix(in srgb, var(--red) 40%, var(--line))" }} disabled={busy} onClick={() => deleteCost(c)}>×</button>
      </td>
    </tr>
  );
}
