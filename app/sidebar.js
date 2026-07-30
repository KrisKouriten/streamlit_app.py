"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NAV_SECTIONS, activeHref, resolveHref } from "../lib/nav-registry";
import { visibleNav } from "../lib/nav-visibility-rules";
import { toggleFavourite, isFavourite } from "../lib/recent-rules";

/* Persistent left navigation — every section and module, always present, so
   moving between dashboards and operational modules never routes through a
   landing page. Groups collapse (remembered); the active group auto-opens.
   Planned modules carry a "soon" chip and open their planned page. Narrow
   screens get a drawer (the top-bar menu button dispatches "fos:sidebar").

   Favourites: a ☆ sits against every sub-header — starring it drops that page
   into the collapsible "Favourites" folder at the top of the nav. Personal and
   local (localStorage "fos-favourites"), shared with My Finance Home via the
   "fos:favourites" event; no governed/server state. */

export default function Sidebar({ hiddenNav = [] } = {}) {
  const path = usePathname();
  const sections = visibleNav(NAV_SECTIONS, hiddenNav);
  const [open, setOpen] = useState({});
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [favs, setFavs] = useState([]);
  const active = activeHref(path);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem("fos-nav") || "{}"); setOpen(s); } catch {}
    const loadFavs = () => { try { setFavs(JSON.parse(localStorage.getItem("fos-favourites") || "[]")); } catch { setFavs([]); } };
    loadFavs();
    const mq = window.matchMedia("(max-width: 940px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on);
    const toggle = () => setDrawer((d) => !d);
    window.addEventListener("fos:sidebar", toggle);
    window.addEventListener("fos:favourites", loadFavs);
    window.addEventListener("storage", loadFavs);
    return () => { mq.removeEventListener("change", on); window.removeEventListener("fos:sidebar", toggle); window.removeEventListener("fos:favourites", loadFavs); window.removeEventListener("storage", loadFavs); };
  }, []);
  useEffect(() => { setDrawer(false); }, [path]);

  const favHrefs = useMemo(() => new Set(favs.map((f) => f.href)), [favs]);

  if (path === "/login") return null;

  function flip(key) {
    setOpen((o) => {
      const next = { ...o, [key]: !isOpen(o, key) };
      try { localStorage.setItem("fos-nav", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // default: section containing the active item is open; others follow saved state (default closed except favourites/home/dashboards)
  function isOpen(state, key) {
    if (key in state) return state[key];
    if (NAV_SECTIONS.find((s) => s.key === key)?.items.some((it) => resolveHref(it) === active)) return true;
    return key === "favourites" || key === "home" || key === "dashboards";
  }

  // Toggle a page in/out of favourites and let the rest of the app know.
  function toggleFav(entry) {
    const next = toggleFavourite(favs, entry);
    try { localStorage.setItem("fos-favourites", JSON.stringify(next)); } catch {}
    setFavs(next);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fos:favourites"));
  }

  const favsOpen = isOpen(open, "favourites");

  const body = (
    <nav aria-label="Primary" style={{ width: 246, flex: "none", height: "100%", overflowY: "auto", padding: "14px 10px 40px", display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Favourites folder — always present, so it's a discoverable home for starred pages. */}
      <div style={{ marginBottom: 4, paddingBottom: 6, borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "stretch", borderRadius: 8, overflow: "hidden" }}>
          <button onClick={() => flip("favourites")} aria-expanded={favsOpen} aria-label={`${favsOpen ? "Collapse" : "Expand"} Favourites`}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, flex: "none", border: "none", background: "transparent", color: favs.length ? "var(--amber)" : "var(--faint)" }}>
            <span aria-hidden="true" style={{ display: "inline-block", transform: favsOpen ? "rotate(90deg)" : "none", transition: "transform var(--t-fast) var(--ease)", fontSize: 9 }}>▶</span>
          </button>
          <button onClick={() => flip("favourites")} aria-label="Favourites"
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "7px 10px 7px 2px", border: "none", background: "transparent", cursor: "pointer",
              fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: favs.length ? "var(--amber)" : "var(--faint)" }}>
            <span aria-hidden="true" style={{ fontSize: 11 }}>★</span> Favourites
          </button>
        </div>
        {favsOpen && (
          favs.length === 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--faint)", padding: "2px 10px 6px 28px", lineHeight: 1.5 }}>
              Star any item below (☆) to pin it here.
            </div>
          ) : (
            favs.map((f) => (
              <NavRow key={f.href} href={f.href} label={f.label} on={f.href === active}
                isFav onToggleFav={() => toggleFav(f)} />
            ))
          )
        )}
      </div>

      {sections.map((s) => {
        const opened = isOpen(open, s.key);
        const hasActive = s.items.some((it) => resolveHref(it) === active);
        return (
          <div key={s.key} style={{ marginBottom: 2 }}>
            <div style={{ display: "flex", alignItems: "stretch", borderRadius: 8, overflow: "hidden" }}>
              <button onClick={() => flip(s.key)} aria-expanded={opened} aria-label={`${opened ? "Collapse" : "Expand"} ${s.label}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, flex: "none", border: "none", background: "transparent", color: hasActive ? "var(--accent)" : "var(--faint)" }}>
                <span aria-hidden="true" style={{ display: "inline-block", transform: opened ? "rotate(90deg)" : "none", transition: "transform var(--t-fast) var(--ease)", fontSize: 9 }}>▶</span>
              </button>
              <Link href={`/section/${s.key}`} aria-current={active === `/section/${s.key}` ? "page" : undefined}
                style={{ flex: 1, display: "flex", alignItems: "center", padding: "7px 10px 7px 2px", textDecoration: "none",
                  fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
                  color: hasActive ? "var(--accent)" : "var(--faint)", transition: "color var(--t-fast) var(--ease)" }}>
                {s.label}
              </Link>
            </div>
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
                  const soon = it.slug && href.startsWith("/module/");
                  return (
                    <NavRow key={it.label} href={href} label={it.label} on={on} soon={soon}
                      isFav={favHrefs.has(href)} onToggleFav={() => toggleFav({ href, label: it.label })} />
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
    <aside className="no-print" style={{ position: "sticky", top: 57, height: "calc(100vh - 57px)", flex: "none", borderRight: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--surface) 45%, transparent)" }}>
      {body}
    </aside>
  );
}

/* A nav sub-item: the link, plus a ☆/★ toggle that pins it to Favourites. The
   star is a sibling of the link (not inside it) so a click never navigates. */
function NavRow({ href, label, on, isFav = false, soon = false, onToggleFav }) {
  return (
    <div className="fos-navrow" style={{ display: "flex", alignItems: "center", borderRadius: 8, background: on ? "var(--accent-bg)" : "transparent" }}>
      <Link href={href} aria-current={on ? "page" : undefined}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: "6px 2px 6px 26px", textDecoration: "none",
          fontSize: 12.5, fontWeight: on ? 600 : 450, color: on ? "var(--accent)" : "var(--muted)",
          transition: "color var(--t-fast) var(--ease)" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {soon && <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 4px", flex: "none" }}>soon</span>}
      </Link>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav?.(); }}
        title={isFav ? "Remove from Favourites" : "Add to Favourites"} aria-label={isFav ? `Remove ${label} from Favourites` : `Add ${label} to Favourites`} aria-pressed={isFav}
        style={{ flex: "none", border: "none", background: "none", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "6px 8px", color: isFav ? "var(--amber)" : "var(--faint)" }}>
        {isFav ? "★" : "☆"}
      </button>
    </div>
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
