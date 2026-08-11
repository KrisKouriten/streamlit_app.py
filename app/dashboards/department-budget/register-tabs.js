"use client";
import { useState } from "react";

/* Tabbed procurement register — one tab per source (Miniso / Local / Other) so a
   long list of Miniso orders doesn't crowd out the Local ones; the team focuses on
   one at a time. Each tab's table is pre-rendered on the server and passed in as
   `content`; this component only toggles which one is shown. Empty sources are
   dropped so a tab never opens onto nothing. */
export default function RegisterTabs({ tabs }) {
  const list = (tabs || []).filter((t) => t && t.count > 0);
  const [active, setActive] = useState(list[0]?.key || null);
  if (!list.length) return <div style={{ fontSize: 13, color: "var(--faint)" }}>No procurement purchases yet.</div>;
  const cur = list.find((t) => t.key === active) || list[0];
  const tabStyle = (on) => ({
    fontSize: 12.5, fontWeight: 650, padding: "6px 13px", borderRadius: 8, cursor: "pointer",
    border: "1px solid " + (on ? "var(--accent)" : "var(--line)"),
    background: on ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface)",
    color: on ? "var(--accent)" : "var(--muted)",
  });
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {list.map((t) => (
          <button key={t.key} type="button" style={tabStyle(t.key === cur.key)} onClick={() => setActive(t.key)}>
            {t.label} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {t.count}</span>
          </button>
        ))}
      </div>
      {cur.content}
    </div>
  );
}
