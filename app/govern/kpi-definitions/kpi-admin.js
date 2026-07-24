"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* Client UI for the KPI catalogue: a table of governed KPIs with an inline
   add/edit form. Mirrors the entity register. Code is immutable once set. */

const DIRECTIONS = ["UP", "DOWN", "TARGET", "RANGE"];
const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];
const BLANK = { code: "", name: "", domain: "", description: "", calculation: "", unit: "", direction: "UP", frequency: "MONTHLY", businessOwner: "", financeOwner: "", isActive: true };

async function api(body) {
  const res = await fetch("/api/kpi-definitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fromRow(k) {
  return {
    code: k.kpi_code, name: k.kpi_name, domain: k.dashboard_domain || "", description: k.description || "",
    calculation: k.calculation_logic || "", unit: k.unit_of_measure || "", direction: k.favourable_direction || "UP",
    green: k.green_threshold ?? "", amber: k.amber_threshold ?? "", frequency: k.frequency || "MONTHLY",
    businessOwner: k.business_owner || "", financeOwner: k.finance_owner || "", isActive: k.is_active,
  };
}

function KpiForm({ initial, editingId, onDone, onCancel }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    setErr(""); setBusy(true);
    try {
      if (editingId) await api({ action: "update", kpiId: editingId, ...f });
      else await api({ action: "create", ...f });
      onDone(); router.refresh();
    } catch (x) { setErr(x.message); setBusy(false); }
  }

  const field = (label, node) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: "var(--muted)" }}>{label}{node}</label>
  );
  return (
    <div className="fos-card" style={{ padding: "14px 18px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
      {err && <div style={{ width: "100%", color: "var(--red)", fontSize: 12.5 }}>{err}</div>}
      {field("Code", <input className="fos-input" style={{ width: 150 }} value={f.code} disabled={!!editingId} onChange={set("code")} placeholder="LFL_SALES" />)}
      {field("Name", <input className="fos-input" style={{ width: 240 }} value={f.name} onChange={set("name")} placeholder="Like-for-like sales" />)}
      {field("Domain", <input className="fos-input" style={{ width: 150 }} value={f.domain} onChange={set("domain")} placeholder="STORE_SALES" />)}
      {field("Unit", <input className="fos-input" style={{ width: 100 }} value={f.unit} onChange={set("unit")} placeholder="£ / % / #" />)}
      {field("Favourable", <select className="fos-input" style={{ width: "auto" }} value={f.direction} onChange={set("direction")}>{DIRECTIONS.map((d) => <option key={d}>{d}</option>)}</select>)}
      {field("Frequency", <select className="fos-input" style={{ width: "auto" }} value={f.frequency} onChange={set("frequency")}>{FREQUENCIES.map((d) => <option key={d}>{d}</option>)}</select>)}
      {field("Finance owner", <input className="fos-input" style={{ width: 170 }} value={f.financeOwner} onChange={set("financeOwner")} />)}
      {field("Business owner", <input className="fos-input" style={{ width: 170 }} value={f.businessOwner} onChange={set("businessOwner")} />)}
      {field("Calculation", <input className="fos-input" style={{ width: 360 }} value={f.calculation} onChange={set("calculation")} placeholder="How it's computed" />)}
      {editingId && field("Active", <input type="checkbox" checked={f.isActive} onChange={set("isActive")} style={{ width: 18, height: 18 }} />)}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button className="fos-btn" onClick={save} disabled={busy}>{busy ? "Saving…" : editingId ? "Save" : "Add KPI"}</button>
        <button className="fos-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export default function KpiAdmin({ kpis, canManage }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  return (
    <div>
      {canManage && !adding && !editing && (
        <button className="fos-btn-ghost" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>New KPI</button>
      )}
      {adding && <KpiForm initial={BLANK} editingId={null} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}

      <div className="fos-card" style={{ padding: "6px 18px" }}>
        {kpis.length === 0 && <div style={{ padding: "12px 0", fontSize: 13, color: "var(--faint)" }}>No KPIs defined yet.</div>}
        {kpis.map((k, i) => (
          editing === k.kpi_id
            ? <KpiForm key={k.kpi_id} initial={fromRow(k)} editingId={k.kpi_id} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
            : (
              <div key={k.kpi_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none", opacity: k.is_active ? 1 : 0.5 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                    {k.kpi_name} <span style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>{k.kpi_code}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {k.dashboard_domain}{k.unit_of_measure ? ` · ${k.unit_of_measure}` : ""}{k.favourable_direction ? ` · ${k.favourable_direction} good` : ""}{k.finance_owner ? ` · ${k.finance_owner}` : ""}
                  </div>
                </div>
                {canManage && <button className="fos-btn-ghost" style={{ fontSize: 11.5, padding: "2px 9px" }} onClick={() => setEditing(k.kpi_id)}>Edit</button>}
              </div>
            )
        ))}
      </div>
    </div>
  );
}
