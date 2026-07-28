"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/* Department sign-off — who approves each department's budgets & P.Os. A
   department can have several approvers (e.g. Finance = Kris + Sergio). */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" };
const chip = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "4px 8px", borderRadius: 7, background: "var(--raise)", border: "1px solid var(--line)" };
const input = { fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

export default function DepartmentSignoff({ departments, signoffs, users }) {
  const router = useRouter();
  const [pick, setPick] = useState({}); // department → selected user email
  const [err, setErr] = useState(null);

  async function post(body) {
    setErr(null);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || "Action failed"); return; }
    router.refresh();
  }

  function add(dept) {
    const email = pick[dept];
    const u = users.find((x) => x.email === email);
    if (!u) { setErr("Choose a person to add"); return; }
    post({ action: "add-signoff", department: dept, email: u.email, name: u.name });
    setPick((p) => ({ ...p, [dept]: "" }));
  }

  return (
    <div>
      {err && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
        {departments.map((dept) => {
          const people = signoffs.filter((s) => s.department === dept);
          return (
            <div key={dept} style={card}>
              <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 10 }}>{dept}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, minHeight: 26 }}>
                {people.length ? people.map((p) => (
                  <span key={p.signoff_id} style={chip}>
                    {p.signoff_name || p.signoff_email}
                    <button onClick={() => post({ action: "remove-signoff", signoffId: p.signoff_id })} title="Remove"
                      style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", fontSize: 13, lineHeight: 1 }}>×</button>
                  </span>
                )) : <span style={{ fontSize: 12, color: "var(--faint)" }}>No sign-off assigned yet.</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={pick[dept] || ""} onChange={(e) => setPick((p) => ({ ...p, [dept]: e.target.value }))} style={{ ...input, flex: 1 }}>
                  <option value="">Add a person…</option>
                  {users.filter((u) => !people.some((p) => p.signoff_email === u.email)).map((u) => (
                    <option key={u.email} value={u.email}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <button onClick={() => add(dept)} style={{ ...input, cursor: "pointer", fontWeight: 600, color: "var(--accent)", borderColor: "var(--accent)" }}>Add</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
