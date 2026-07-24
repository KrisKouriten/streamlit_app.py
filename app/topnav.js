"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { badgeLabel } from "../lib/notification-rules";

/* Slim glass top bar. Section navigation lives in the persistent sidebar;
   this keeps the brand, menu (narrow screens), Search ⌘K, theme and account. */

function MenuButton() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 940px)");
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (!narrow) return null;
  return (
    <button className="fos-btn-ghost" aria-label="Open navigation" style={{ width: 34, padding: 0, justifyContent: "center", fontSize: 15 }}
      onClick={() => window.dispatchEvent(new Event("fos:sidebar"))}>≡</button>
  );
}

function PaletteTrigger() {
  const [mac, setMac] = useState(true);
  useEffect(() => { setMac(/mac/i.test(navigator.platform || "")); }, []);
  return (
    <button className="fos-btn-ghost" aria-label="Open command palette"
      onClick={() => window.dispatchEvent(new Event("fos:palette"))}>
      <span>Search</span>
      <span className="fos-kbd" style={{ marginLeft: 2 }}>{mac ? "⌘K" : "Ctrl K"}</span>
    </button>
  );
}

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => { setLight(document.documentElement.getAttribute("data-theme") === "light"); }, []);
  function toggle() {
    const next = !light;
    if (next) { document.documentElement.setAttribute("data-theme", "light"); try { localStorage.setItem("fos-theme", "light"); } catch {} }
    else { document.documentElement.removeAttribute("data-theme"); try { localStorage.setItem("fos-theme", "dark"); } catch {} }
    setLight(next);
  }
  return (
    <button onClick={toggle} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title={light ? "Dark" : "Light"}
      className="fos-btn-ghost" style={{ width: 32, padding: 0, justifyContent: "center", fontSize: 13.5 }}>
      {light ? "☾" : "☀"}
    </button>
  );
}

function NotifBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/notifications?count", { cache: "no-store" });
        if (r.ok) { const d = await r.json(); if (alive) setCount(d.count || 0); }
      } catch {}
    };
    load();
    const id = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, []);
  const label = badgeLabel(count);
  return (
    <Link href="/inbox" title="Notifications" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
      className="fos-btn-ghost" style={{ width: 32, padding: 0, justifyContent: "center", position: "relative", fontSize: 14 }}>
      <span aria-hidden>&#128276;</span>
      {label && (
        <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: "var(--accent)", color: "var(--accent-ink)", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{label}</span>
      )}
    </Link>
  );
}

function UserChip({ name }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => { setOpen(false); }, []);

  async function signOut() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    router.push("/login");
    router.refresh();
  }

  const item = {
    display: "flex", alignItems: "center", width: "100%", gap: 8, padding: "9px 12px", borderRadius: 8,
    fontSize: 13, fontWeight: 500, textAlign: "left", textDecoration: "none", color: "var(--ink)",
    background: "transparent", border: "none", cursor: "pointer",
  };

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        title={`${name} · Account menu`} aria-label="Account menu" style={{
          width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--accent)",
          background: "var(--accent-bg)", border: "1px solid var(--accent-deep)", flex: "none", padding: 0,
        }}>{initials}</button>

      {open && (
        <div role="menu" className="fos-glass" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 214, padding: 6, borderRadius: 12,
          boxShadow: "var(--shadow-pop)", animation: "fosRise .16s var(--ease) both", zIndex: 200,
        }}>
          <div style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--hairline)", marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: "var(--ink)", lineHeight: 1.2 }}>{name}</div>
            <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", letterSpacing: ".04em", marginTop: 2 }}>Signed in</div>
          </div>
          <Link href="/account/security" role="menuitem" onClick={() => setOpen(false)} style={item}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <span aria-hidden style={{ width: 16, textAlign: "center" }}>&#128273;</span>
            <span>Change password</span>
          </Link>
          <Link href="/account/security" role="menuitem" onClick={() => setOpen(false)} style={item}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <span aria-hidden style={{ width: 16, textAlign: "center" }}>&#9881;</span>
            <span>Account &amp; security</span>
          </Link>
          <button role="menuitem" onClick={signOut} disabled={busy} style={{ ...item, color: "var(--red)", opacity: busy ? 0.6 : 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--red-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <span aria-hidden style={{ width: 16, textAlign: "center" }}>&#8618;</span>
            <span>{busy ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopNav({ userName }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="fos-glass no-print" style={{ borderLeft: "none", borderRight: "none", borderTop: "none", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ padding: "0 1.1rem", display: "flex", alignItems: "center", gap: 10, height: 56 }}>
        <MenuButton />
        <Link href="/finance-os/executive" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", flex: "none",
            background: "radial-gradient(circle at 35% 30%, var(--accent), var(--accent-deep))",
            boxShadow: "0 0 0 3px var(--accent-bg), 0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".09em", color: "var(--ink)" }}>MINISO UK · FINANCE OS</span>
        </Link>
        <div style={{ flex: 1 }} />
        <PaletteTrigger />
        {userName && <NotifBell />}
        <ThemeToggle />
        {userName && <UserChip name={userName} />}
      </div>
    </nav>
  );
}
