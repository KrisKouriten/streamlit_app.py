"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

function UserChip({ name }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  async function signOut() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    router.push("/login");
    router.refresh();
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden="true" title={name} style={{
        width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--accent)",
        background: "var(--accent-bg)", border: "1px solid var(--accent-deep)", flex: "none",
      }}>{initials}</span>
      <button onClick={signOut} disabled={busy} title="Sign out" className="fos-btn-ghost" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

export default function TopNav({ userName }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="fos-glass" style={{ borderLeft: "none", borderRight: "none", borderTop: "none", position: "sticky", top: 0, zIndex: 100 }}>
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
        <ThemeToggle />
        {userName && <UserChip name={userName} />}
      </div>
    </nav>
  );
}
