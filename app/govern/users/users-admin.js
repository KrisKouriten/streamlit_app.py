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
  const [linkInfo, setLinkInfo] = useState(null); // { email, link, reason } — manual fallback
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "FINANCE" });
  const [invite, setInvite] = useState(true); // default: email an invite rather than set a password

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setUsers(data.users || []);
    else setError(data.error || "Could not load users");
  }, []);
  useEffect(() => { load(); }, [load]);

  // Turn a delivery result into either a "sent" notice or a copyable fallback
  // link (when email isn't configured or the send failed).
  function reflectDelivery(data, sentMsg) {
    if (data.emailSent) { setNotice(sentMsg); setLinkInfo(null); return; }
    if (data.link) {
      setNotice("");
      setLinkInfo({
        link: data.link,
        reason: data.reason === "not-configured"
          ? "Email isn't set up yet, so nothing was sent. Copy this one-time link and share it securely:"
          : "The email couldn't be sent, so copy this one-time link and share it securely:",
      });
    } else {
      setNotice(sentMsg);
    }
  }

  async function post(body, okMsg, onData) {
    setError(""); setNotice(""); setLinkInfo(null);
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || "Something went wrong"); return false; }
    if (onData) onData(data); else setNotice(okMsg);
    load(); return true;
  }

  async function createUser(e) {
    e.preventDefault();
    const body = { action: "create", name: form.name, email: form.email, role: form.role };
    if (!invite) body.password = form.password; // omit -> server emails an invite
    const ok = await post(body, "", (data) => {
      if (data.invited) reflectDelivery(data, `Invite sent to ${form.email}.`);
      else setNotice(`User ${form.email} created.`);
    });
    if (ok) setForm({ name: "", email: "", password: "", role: "FINANCE" });
  }

  async function resetPassword(u) {
    const pw = window.prompt(`Set a password directly for ${u.name} (8+ characters).\nLeave blank and cancel to email a reset link instead:`);
    if (pw === null) return;
    if (!pw) return;
    await post({ action: "reset-password", userId: u.id, password: pw }, `Password set for ${u.name}.`);
  }

  async function sendLink(u, action) {
    const verb = action === "invite" ? "invite" : "reset link";
    await post({ action, userId: u.id }, "", (data) => reflectDelivery(data, `${verb[0].toUpperCase()}${verb.slice(1)} sent to ${u.email}.`));
  }

  function statusOf(u) {
    if (!u.is_active) return { label: "DEACTIVATED", color: "var(--red)" };
    if (u.must_change_password) return { label: "INVITED", color: "var(--amber)" };
    return { label: "ACTIVE", color: "var(--green)" };
  }

  return (
    <div>
      {error && <div style={{ fontSize: 13.5, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ fontSize: 13.5, color: "var(--green)", marginBottom: 12 }}>{notice}</div>}
      {linkInfo && (
        <div style={{ fontSize: 13, background: "var(--amber-bg)", border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 8, color: "var(--ink)" }}>{linkInfo.reason}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={linkInfo.link} onFocus={(e) => e.target.select()} style={{ ...input, flex: 1, minWidth: 260, fontFamily: "var(--mono)", fontSize: 12 }} />
            <button style={{ ...btnGhost, height: 36 }} onClick={() => { navigator.clipboard?.writeText(linkInfo.link); setNotice("Link copied."); }}>Copy</button>
          </div>
        </div>
      )}

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr>
            {["Name", "Email", "Role", "Status", ""].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--line)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {users.map((u) => {
              const st = statusOf(u);
              return (
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
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: st.color }}>{st.label}</span>
                </td>
                <td style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {u.must_change_password ? (
                    <button style={{ ...btnGhost, height: 30, fontSize: 12.5, marginRight: 6 }} onClick={() => sendLink(u, "invite")}>Resend invite</button>
                  ) : (
                    <button style={{ ...btnGhost, height: 30, fontSize: 12.5, marginRight: 6 }} onClick={() => sendLink(u, "email-reset")}>Email reset link</button>
                  )}
                  <button style={{ ...btnGhost, height: 30, fontSize: 12.5, marginRight: 6 }} onClick={() => resetPassword(u)}>Set password</button>
                  {u.id !== me.id && (
                    <button style={{ ...btnGhost, height: 30, fontSize: 12.5 }}
                      onClick={() => post({ action: "set-active", userId: u.id, isActive: !u.is_active }, `${u.name} ${u.is_active ? "deactivated" : "reactivated"}.`)}>
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Add a user</div>
      <form onSubmit={createUser} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={input} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input style={input} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        {!invite && (
          <input style={input} type="password" placeholder="Password (8+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
        )}
        <select style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" style={btn}>{invite ? "Send invite" : "Create user"}</button>
      </form>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)", marginTop: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        Email an invite — the user sets their own password via a one-time link (recommended). Uncheck to set a password yourself.
      </label>
      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
        Every change here is written to the audit trail. Passwords are stored hashed; nobody can read them back.
      </div>
    </div>
  );
}
