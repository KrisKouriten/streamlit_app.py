"use client";

import { ALL_DEPTS } from "../lib/dept-tabs-rules.js";

/*
 * A row of department tabs with a count on each. `tabs` comes from
 * deptTabsFor(); ALL_DEPTS renders as "All departments".
 */
export default function DeptTabs({ tabs = [], active, onChange, counts = {} }) {
  if (!tabs.length) return null;
  return (
    <nav style={{ display: "flex", gap: 2, flexWrap: "wrap", borderBottom: "1px solid var(--line)", marginBottom: 14 }}>
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button key={t} type="button" onClick={() => onChange(t)} style={{
            padding: "8px 12px", fontSize: 13, cursor: "pointer", background: "transparent", border: "none", whiteSpace: "nowrap",
            color: on ? "var(--ink)" : "var(--muted)", fontWeight: on ? 650 : 500,
            borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1,
          }}>
            {t === ALL_DEPTS ? "All departments" : t}
            {counts[t] != null && <span style={{ color: "var(--faint)", fontWeight: 500, marginLeft: 6 }}>{counts[t]}</span>}
          </button>
        );
      })}
    </nav>
  );
}
