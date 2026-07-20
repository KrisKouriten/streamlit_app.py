"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PILLARS = [
  ["HOME", "/finance-os/executive", ["/finance-os/executive"]],
  ["PLAN", "/plan", ["/plan", "/finance-os/budget-forecast"]],
  ["DASHBOARDS", "/dashboards", ["/dashboards", "/finance-os/management-accounts", "/finance-os/cashflow", "/finance-os/store-sales", "/finance-os/inventory", "/finance-os/franchise", "/finance-os/fixed-assets"]],
  ["OPERATE", "/operate", ["/operate"]],
  ["WORKFLOW", "/perform", ["/perform", "/operate/month-end"]],
  ["AI CONTROL TOWER", "/ai", ["/ai"]],
  ["GOVERN", "/govern", ["/govern", "/handbook"]],
];

function activePillar(path) {
  let best = null, bestLen = -1;
  for (const [name, , prefixes] of PILLARS) {
    for (const p of prefixes) {
      if (p !== "/" && path.startsWith(p) && p.length > bestLen) { best = name; bestLen = p.length; }
    }
  }
  return best;
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
  const active = activePillar(path);
  return (
    <nav className="fos-glass" style={{ borderLeft: "none", borderRight: "none", borderTop: "none", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 1.25rem", display: "flex", alignItems: "center", gap: 10, overflowX: "auto" }}>
        <Link href="/finance-os/executive" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", padding: "13px 8px 13px 0", whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", flex: "none",
            background: "radial-gradient(circle at 35% 30%, var(--accent), var(--accent-deep))",
            boxShadow: "0 0 0 3px var(--accent-bg), 0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".09em", color: "var(--ink)" }}>MINISO UK · FINANCE OS</span>
        </Link>
        <div style={{ flex: 1, display: "flex", gap: 2, justifyContent: "flex-end" }}>
          {PILLARS.map(([name, href]) => {
            const on = name === active;
            return (
              <Link key={name} href={href} aria-current={on ? "page" : undefined} style={{
                position: "relative", fontSize: 11.5, fontWeight: on ? 700 : 500, letterSpacing: ".05em",
                color: on ? "var(--accent)" : "var(--muted)", textDecoration: "none",
                padding: "15px 10px", whiteSpace: "nowrap",
                transition: "color var(--t-fast) var(--ease)",
              }}>
                {name}
                <span aria-hidden="true" style={{
                  position: "absolute", left: 10, right: 10, bottom: 0, height: 2, borderRadius: 2,
                  background: "var(--accent)", transformOrigin: "center",
                  transform: on ? "scaleX(1)" : "scaleX(0)", opacity: on ? 1 : 0,
                  transition: "transform var(--t-med) var(--ease), opacity var(--t-med) var(--ease)",
                }} />
              </Link>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}>
          <PaletteTrigger />
          <ThemeToggle />
          {userName && <UserChip name={userName} />}
        </div>
      </div>
    </nav>
  );
}
