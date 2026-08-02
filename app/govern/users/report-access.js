"use client";

import { useMemo, useState } from "react";

/*
 * Department report access (ADMIN only — enforced again server-side, migration 064).
 * A department × report matrix. The first release exposes CAN VIEW and CAN EXPORT
 * (both enforced on read and on export); the wider verbs are stored in the model
 * and can be surfaced later. Finance / Exec / Admin always have full access, so
 * they are not listed here — this grants access to the other departments.
 */

const lbl = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };

export default function ReportAccessMatrix({ departments = [], templates = [], initialPermissions = [] }) {
  const [perms, setPerms] = useState(initialPermissions);
  const [dept, setDept] = useState(departments[0] || "");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  const byKey = useMemo(() => {
    const m = {};
    for (const p of perms) m[`${p.department}:${p.template_key}`] = p;
    return m;
  }, [perms]);

  async function toggle(template_key, verb) {
    const key = `${dept}:${template_key}`;
    const existing = byKey[key] || { department: dept, template_key, can_view: false, can_export: false, active: true };
    const next = { ...existing, active: true, [verb]: !existing[verb] };
    setBusyKey(`${key}:${verb}`); setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-report-permission", permission: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      setPerms((prev) => [...prev.filter((p) => !(p.department === dept && p.template_key === template_key)), next]);
    } catch (e) { setError(e.message); }
    finally { setBusyKey(""); }
  }

  if (!departments.length || !templates.length) {
    return <div style={{ fontSize: 13, color: "var(--muted)" }}>No departments or report templates are available yet.</div>;
  }

  const cellBtn = (on, busy) => ({
    width: 26, height: 26, borderRadius: 6, cursor: busy ? "default" : "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
    background: on ? "var(--accent)" : "var(--bg)", color: on ? "#fff" : "transparent",
    fontSize: 14, lineHeight: 1, opacity: busy ? 0.5 : 1,
  });

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {departments.map((name) => {
          const on = name === dept;
          return (
            <button key={name} onClick={() => setDept(name)} style={{
              height: 30, padding: "0 12px", borderRadius: 100, cursor: "pointer", fontSize: 12.5,
              border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
              background: on ? "var(--accent)" : "var(--bg)", color: on ? "#fff" : "var(--ink)",
            }}>{name}</button>
          );
        })}
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 10px", ...lbl }}>Corporate report</th>
              <th style={{ padding: "6px 10px", ...lbl }}>View</th>
              <th style={{ padding: "6px 10px", ...lbl }}>Export</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const p = byKey[`${dept}:${t.template_key}`] || {};
              return (
                <tr key={t.template_key} style={{ borderTop: "1px solid var(--hairline)" }}>
                  <td style={{ padding: "8px 10px", color: "var(--ink)" }}>{t.name}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button style={cellBtn(!!p.can_view, busyKey === `${dept}:${t.template_key}:can_view`)}
                      disabled={!!busyKey} onClick={() => toggle(t.template_key, "can_view")} title="Can view">✓</button>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button style={cellBtn(!!p.can_export, busyKey === `${dept}:${t.template_key}:can_export`)}
                      disabled={!!busyKey} onClick={() => toggle(t.template_key, "can_export")} title="Can export">✓</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 12 }}>
        Finance, Exec and Admin always have full access. Granting a report here lets that department view (and, if ticked, export) it in the Corporate Reporting Centre.
      </p>
    </div>
  );
}
