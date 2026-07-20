"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PILLARS = [
  ["HOME", "/finance-os/executive", ["/finance-os/executive"]],
  ["PLAN", "/plan", ["/plan", "/finance-os/budget-forecast"]],
  ["DASHBOARDS", "/dashboards", ["/dashboards", "/finance-os/management-accounts", "/finance-os/cashflow", "/finance-os/store-sales", "/finance-os/inventory", "/finance-os/franchise", "/finance-os/fixed-assets"]],
  ["OPERATE", "/operate", ["/operate"]],
  ["WORKFLOW", "/perform", ["/perform"]],
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
      style={{ background: "transparent", border: "1px solid var(--line-strong)", color: "var(--muted)", borderRadius: 7, width: 30, height: 30, fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {light ? "☾" : "☀"}
    </button>
  );
}

function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={signOut} disabled={busy} title="Sign out"
      style={{ background: "transparent", border: "1px solid var(--line-strong)", color: "var(--muted)", borderRadius: 7, height: 30, padding: "0 11px", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", flex: "none", opacity: busy ? 0.6 : 1 }}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export default function TopNav({ userName }) {
  const path = usePathname();
  if (path === "/login") return null;
  const active = activePillar(path);
  return (
    <nav style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 1.25rem", display: "flex", alignItems: "center", gap: 8, overflowX: "auto" }}>
        <Link href="/finance-os/executive" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", padding: "12px 8px 12px 0", whiteSpace: "nowrap" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-bg)", flex: "none" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".08em", color: "var(--ink)" }}>MINISO UK · FINANCE OS</span>
        </Link>
        <div style={{ flex: 1, display: "flex", gap: 2, justifyContent: "flex-end" }}>
          {PILLARS.map(([name, href]) => {
            const on = name === active;
            return (
              <Link key={name} href={href} aria-current={on ? "page" : undefined} style={{
                fontSize: 11.5, fontWeight: on ? 700 : 500, letterSpacing: ".05em",
                color: on ? "var(--accent)" : "var(--muted)", textDecoration: "none",
                padding: "13px 10px", whiteSpace: "nowrap",
                borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              }}>{name}</Link>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 6 }}>
          <ThemeToggle />
          {userName && <span style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>{userName}</span>}
          <SignOut />
        </div>
      </div>
    </nav>
  );
}
