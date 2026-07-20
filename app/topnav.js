"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PILLARS = [
  ["HOME", "/finance-os/executive", ["/finance-os/executive"]],
  ["PLAN", "/plan", ["/plan", "/finance-os/budget-forecast"]],
  ["PERFORM", "/perform", ["/perform", "/finance-os/management-accounts", "/"]],
  ["OPERATE", "/operate", ["/operate", "/finance-os/store-sales", "/finance-os/franchise", "/finance-os/fixed-assets", "/finance-os/inventory", "/finance-os/cashflow"]],
  ["AI CONTROL TOWER", "/ai", ["/ai"]],
  ["GOVERN", "/govern", ["/govern"]],
];

function activePillar(path) {
  if (path === "/") return "PERFORM";
  let best = null, bestLen = -1;
  for (const [name, , prefixes] of PILLARS) {
    for (const p of prefixes) {
      if (p !== "/" && path.startsWith(p) && p.length > bestLen) { best = name; bestLen = p.length; }
    }
  }
  return best;
}

export default function TopNav({ userName }) {
  const path = usePathname();
  if (path === "/login") return null;
  const active = activePillar(path);
  return (
    <nav style={{
      borderBottom: "1px solid var(--line)", background: "var(--surface)",
      position: "sticky", top: 0, zIndex: 50,
    }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 1.25rem", display: "flex", alignItems: "center", gap: 4, overflowX: "auto" }}>
        <Link href="/finance-os" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".06em", color: "var(--ink)", textDecoration: "none", padding: "12px 10px 12px 0", whiteSpace: "nowrap" }}>
          MINISO UK · FINANCE OS
        </Link>
        <div style={{ flex: 1, display: "flex", gap: 2, justifyContent: "flex-end" }}>
          {PILLARS.map(([name, href]) => {
            const on = name === active;
            return (
              <Link key={name} href={href} aria-current={on ? "page" : undefined} style={{
                fontSize: 12, fontWeight: on ? 700 : 500, letterSpacing: ".04em",
                color: on ? "var(--accent)" : "var(--muted)", textDecoration: "none",
                padding: "12px 10px", whiteSpace: "nowrap",
                borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              }}>{name}</Link>
            );
          })}
        </div>
        {userName && <span style={{ fontSize: 12, color: "var(--faint)", padding: "12px 0 12px 10px", whiteSpace: "nowrap" }}>{userName}</span>}
      </div>
    </nav>
  );
}
