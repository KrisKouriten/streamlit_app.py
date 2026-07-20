"use client";

import { useState, useEffect, useCallback } from "react";

/* Users & roles admin (ADMIN only — enforced again server-side). */

const ROLES = ["ADMIN", "EXEC", "FINANCE", "OPS", "FRANCHISEE"];
const input = { height: 36, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg)", color: "var(--ink)", fontSize: 14 };
const btn = { height: 36, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 13.5, cursor: "pointer" };
const btnGhost = { ...btn, background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line-strong)" };

export default function UsersAdmin({ me }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "FINANCE" });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setUsers(data.users || []);
    else setError(data.error || "Could not load users");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(body, okMsg) {
    setError(""); setNotice("");
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || "Something went wrong"); return false; }
    setNotice(okMsg); load(); return true;
  }

  async function createUser(e) {
    e.preventDefault();
    if (await post({ action: "create", ...form }, `User ${form.email} created.`)) {
      setForm({ name: "", email: "", password: "", role: "FINANCE" });
    }
  }

  async function resetPassword(u) {
    const pw = window.prompt(`New password for ${u.name} (8+ characters):`);
    if (pw === null) return;
    await post({ action: "reset-password", userId: u.id, password: pw }, `Password reset for ${u.name}.`);
  }

  return (
    <div>
      {error && <div style={{ fontSize: 13.5, color: "#a32d2d", marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ fontSize: 13.5, color: "var(--green)", marginBottom: 12 }}>{notice}</div>}

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr>
            {["Name", "Email", "Role", "Status", ""].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--line)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>{u.name}{u.id === me.id && <span style={{ color: "var(--faint)" }}> (you)</span>}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>{u.email}</td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                  <select value={u.roles[0] || "FINANCE"} disabled={u.id === me.id}
                    onChange={(e) => post({ action: "set-role", userId: u.id, role: e.target.value }, `Role updated for ${u.name}.`)}
                    style={{ ...input, height: 32 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: u.is_active ? "var(--green)" : "#a32d2d" }}>
                    {u.is_active ? "ACTIVE" : "DEACTIVATED"}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button style={{ ...btnGhost, height: 30, fontSize: 12.5, marginRight: 6 }} onClick={() => resetPassword(u)}>Reset password</button>
                  {u.id !== me.id && (
                    <button style={{ ...btnGhost, height: 30, fontSize: 12.5 }}
                      onClick={() => post({ action: "set-active", userId: u.id, isActive: !u.is_active }, `${u.name} ${u.is_active ? "deactivated" : "reactivated"}.`)}>
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Add a user</div>
      <form onSubmit={createUser} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={input} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input style={input} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input style={input} type="password" placeholder="Password (8+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
        <select style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" style={btn}>Create user</button>
      </form>
      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 14 }}>
        Every change here is written to the audit trail. Passwords are stored hashed; nobody can read them back.
      </div>
    </div>
  );
}
