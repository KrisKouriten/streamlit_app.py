"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV_SECTIONS } from "../../../lib/nav-registry";
import { itemId, applyToggle, isSectionVisible, isItemVisible } from "../../../lib/nav-visibility-rules";

/* Access — Admins choose which navigation headers and sub-headers each
   department can see. Unticking a header hides the whole section (its
   sub-headers grey out); with the header ticked, individual sub-headers can
   still be hidden. Default (no rows) = everything visible. Admins always see
   everything regardless of these settings. */

const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" };
const input = { fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

// Group the saved visibility rows into { department -> Set(node_key) }.
function indexVisibility(rows) {
  const m = {};
  for (const r of rows || []) {
    (m[r.department] ||= new Set()).add(r.node_key);
  }
  return m;
}

export default function AccessMatrix({ departments, visibility }) {
  const router = useRouter();
  const saved = useMemo(() => indexVisibility(visibility), [visibility]);
  const [dept, setDept] = useState(departments[0] || "");
  const [hidden, setHidden] = useState(() => new Set(saved[departments[0]] || []));
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  function selectDept(d) {
    setDept(d);
    setHidden(new Set(saved[d] || []));
    setErr(null); setMsg(null);
  }

  function toggle(payload) {
    setMsg(null);
    setHidden((h) => applyToggle(h, payload));
  }

  const dirty = useMemo(() => {
    const base = saved[dept] || new Set();
    if (base.size !== hidden.size) return true;
    for (const k of hidden) if (!base.has(k)) return true;
    return false;
  }, [saved, dept, hidden]);

  async function save() {
    if (!dept) { setErr("Choose a department first."); return; }
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-visibility", department: dept, hiddenKeys: [...hidden] }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error || "Save failed"); return; }
    setMsg("Saved.");
    router.refresh();
  }

  if (!departments.length) {
    return <p style={{ fontSize: 12.5, color: "var(--faint)" }}>No departments defined yet. Add departments first, then set page access here.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, color: "var(--muted)" }}>Department</label>
        <select value={dept} onChange={(e) => selectDept(e.target.value)} style={{ ...input, minWidth: 200 }}>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={save} disabled={busy || !dirty}
          style={{ ...input, cursor: busy || !dirty ? "default" : "pointer", fontWeight: 600,
            color: dirty ? "var(--accent)" : "var(--faint)", borderColor: dirty ? "var(--accent)" : "var(--line)", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Saving…" : "Save access"}
        </button>
        {err && <span style={{ color: "var(--red)", fontSize: 12.5 }}>{err}</span>}
        {msg && <span style={{ color: "var(--green,var(--accent))", fontSize: 12.5 }}>{msg}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
        {NAV_SECTIONS.map((sec) => {
          const secVisible = isSectionVisible(sec, hidden);
          return (
            <div key={sec.key} style={card}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
                <input type="checkbox" checked={secVisible}
                  onChange={(e) => toggle({ kind: "section", sec, visible: e.target.checked })} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
                  color: secVisible ? "var(--ink)" : "var(--faint)" }}>{sec.label}</span>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 4 }}>
                {(sec.items || []).map((it) => {
                  const itVisible = isItemVisible(sec, it, hidden);
                  return (
                    <label key={itemId(it)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: secVisible ? "pointer" : "default", opacity: secVisible ? 1 : 0.45 }}>
                      <input type="checkbox" disabled={!secVisible} checked={secVisible && itVisible}
                        onChange={(e) => toggle({ kind: "item", sec, it, visible: e.target.checked })} />
                      <span style={{ fontSize: 12.5, color: secVisible && itVisible ? "var(--muted)" : "var(--faint)" }}>{it.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
