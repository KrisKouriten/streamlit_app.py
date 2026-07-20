"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_SECTIONS, activeHref, resolveHref } from "../lib/nav-registry";

/* Persistent left navigation — every section and module, always present, so
   moving between dashboards and operational modules never routes through a
   landing page. Groups collapse (remembered); the active group auto-opens.
   Planned modules carry a "soon" chip and open their planned page. Narrow
   screens get a drawer (the top-bar menu button dispatches "fos:sidebar"). */

export default function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState({});
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const active = activeHref(path);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem("fos-nav") || "{}"); setOpen(s); } catch {}
    const mq = window.matchMedia("(max-width: 940px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on);
    const toggle = () => setDrawer((d) => !d);
    window.addEventListener("fos:sidebar", toggle);
    return () => { mq.removeEventListener("change", on); window.removeEventListener("fos:sidebar", toggle); };
  }, []);
  useEffect(() => { setDrawer(false); }, [path]);

  if (path === "/login") return null;

  function flip(key) {
    setOpen((o) => {
      const next = { ...o, [key]: !isOpen(o, key) };
      try { localStorage.setItem("fos-nav", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // default: section containing the active item is open; others follow saved state (default closed except home/dashboards)
  function isOpen(state, key) {
    if (key in state) return state[key];
    if (NAV_SECTIONS.find((s) => s.key === key)?.items.some((it) => resolveHref(it) === active)) return true;
    return key === "home" || key === "dashboards";
  }

  const body = (
    <nav aria-label="Primary" style={{ width: 246, flex: "none", height: "100%", overflowY: "auto", padding: "14px 10px 40px", display: "flex", flexDirection: "column", gap: 2 }}>
      {NAV_SECTIONS.map((s) => {
        const opened = isOpen(open, s.key);
        const hasActive = s.items.some((it) => resolveHref(it) === active);
        return (
          <div key={s.key} style={{ marginBottom: 2 }}>
            <button onClick={() => flip(s.key)} aria-expanded={opened}
              style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "none", background: "transparent",
                fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase",
                color: hasActive ? "var(--accent)" : "var(--faint)", transition: "color var(--t-fast) var(--ease)" }}>
              <span aria-hidden="true" style={{ display: "inline-block", transform: opened ? "rotate(90deg)" : "none", transition: "transform var(--t-fast) var(--ease)", fontSize: 9 }}>▶</span>
              {s.label}
            </button>
            {opened && (
              <div>
                {s.items.map((it) => {
                  if (it.action === "palette") {
                    return (
                      <button key={it.label} onClick={() => window.dispatchEvent(new Event("fos:palette"))}
                        style={{ ...itemStyle(false), border: "none", background: "transparent", width: "100%", textAlign: "left", cursor: "pointer" }}>
                        <span style={{ flex: 1 }}>{it.label}</span>
                        <span className="fos-kbd" style={{ fontSize: 9 }}>⌘K</span>
                      </button>
                    );
                  }
                  const href = resolveHref(it);
                  const on = href === active;
                  return (
                    <Link key={it.label} href={href} aria-current={on ? "page" : undefined} style={itemStyle(on)}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                      {it.slug && href.startsWith("/module/") && <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 4px", flex: "none" }}>soon</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  if (narrow) {
    if (!drawer) return null;
    return (
      <div onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}
        style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(8,7,6,.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}>
        <div className="fos-glass" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 262, boxShadow: "var(--shadow-pop)", animation: "fosRise .2s var(--ease) both" }}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <aside style={{ position: "sticky", top: 57, height: "calc(100vh - 57px)", flex: "none", borderRight: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--surface) 45%, transparent)" }}>
      {body}
    </aside>
  );
}

function itemStyle(on) {
  return {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 26px", borderRadius: 8,
    fontSize: 12.5, fontWeight: on ? 600 : 450, textDecoration: "none",
    color: on ? "var(--accent)" : "var(--muted)",
    background: on ? "var(--accent-bg)" : "transparent",
    transition: "color var(--t-fast) var(--ease), background var(--t-fast) var(--ease)",
  };
}
