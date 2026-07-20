"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["STORE", "FUNCTION", "HOLDING", "GROUP", "BRAND", "OTHER"];
const input = { height: 34, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 13.5, width: "100%" };
const btn = (bg = "var(--accent)", fg = "#1a1813") => ({ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: bg, color: fg, fontSize: 13, fontWeight: 600, cursor: "pointer" });
const ghost = { height: 30, padding: "0 12px", background: "transparent", color: "var(--muted)", border: "1px solid var(--line-strong)", borderRadius: 7, fontSize: 12.5, cursor: "pointer" };

async function api(body) {
  const res = await fetch("/api/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Save failed");
  return data;
}

export default function EntitiesAdmin({ entities, canManage }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState("");

  return (
    <div>
      {canManage && (
        <div style={{ marginBottom: 14 }}>
          {adding ? <EntityForm onClose={() => setAdding(false)} onErr={setErr} router={router} />
            : <button style={btn()} onClick={() => { setErr(""); setAdding(true); }}>Add entity</button>}
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>{err}</div>}

      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 720 }}>
          <thead>
            <tr>
              {["Code", "Display name", "Legal name", "Type", "Xero", "Status", canManage ? "" : null].filter((x) => x !== null).map((h, i) => (
                <th key={i} style={{ textAlign: "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 500, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              editId === e.entity_id ? (
                <tr key={e.entity_id}><td colSpan={canManage ? 7 : 6} style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
                  <EntityForm entity={e} onClose={() => setEditId(null)} onErr={setErr} router={router} />
                </td></tr>
              ) : (
                <tr key={e.entity_id} style={{ opacity: e.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{e.entity_code}</td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", fontWeight: 560, whiteSpace: "nowrap" }}>{e.entity_name}</td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", color: "var(--muted)", whiteSpace: "nowrap" }}>{e.legal_name || "—"}</td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", color: "var(--faint)", fontSize: 12 }}>{e.entity_type || "—"}</td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                    {e.xero_status === "CONNECTED"
                      ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent)", background: "var(--accent-bg)", border: "1px solid var(--accent-deep)", padding: "2px 7px", borderRadius: 5 }}>Connected</span>
                      : <span style={{ fontSize: 12, color: "var(--faint)" }}>—</span>}
                  </td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", fontSize: 12, color: e.is_active ? "var(--green)" : "var(--faint)" }}>{e.is_active ? "Active" : "Retired"}</td>
                  {canManage && <td style={{ padding: "9px 14px", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={ghost} onClick={() => { setErr(""); setEditId(e.entity_id); }}>Edit</button>
                  </td>}
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntityForm({ entity, onClose, onErr, router }) {
  const [f, setF] = useState({
    code: entity?.entity_code || "", name: entity?.entity_name || "", legalName: entity?.legal_name || "",
    type: entity?.entity_type || "STORE", isActive: entity ? entity.is_active : true,
  });
  const editing = !!entity;
  async function save() {
    onErr("");
    try {
      if (editing) await api({ action: "update", entityId: entity.entity_id, name: f.name, legalName: f.legalName, type: f.type, isActive: f.isActive });
      else await api({ action: "create", code: f.code, name: f.name, legalName: f.legalName, type: f.type });
      onClose(); router.refresh();
    } catch (e) { onErr(e.message); }
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, alignItems: "end" }}>
      <div>
        <label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>Code</label>
        <input style={{ ...input, opacity: editing ? 0.6 : 1 }} value={f.code} disabled={editing} placeholder="K-EXAMPLE" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>Display name</label>
        <input style={input} value={f.name} placeholder="Miniso UK — …" onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>Legal name</label>
        <input style={input} value={f.legalName} placeholder="Kouriten … Limited" onChange={(e) => setF({ ...f, legalName: e.target.value })} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "var(--faint)", display: "block", marginBottom: 3 }}>Type</label>
        <select style={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {editing && (
        <label style={{ fontSize: 12.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, height: 34 }}>
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
        </label>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btn()} onClick={save}>{editing ? "Save" : "Create"}</button>
        <button style={ghost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
