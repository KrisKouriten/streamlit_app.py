"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ⌘K command palette — go anywhere, do anything, without touching the mouse.
   Opens on Cmd/Ctrl+K (or the nav trigger firing "fos:palette"); type to filter,
   ↑↓ to move, Enter to run, Esc to close. Glass panel over a dimmed field. */

const NAV = [
  ["Home", [
    ["Executive Hub", "/finance-os/executive", "The connected sphere — position & attention"],
  ]],
  ["Plan", [
    ["Plan hub", "/plan", "Strategic planning"],
    ["Scenario planning", "/plan/scenarios", "Upside / base / downside on the forecast inputs"],
    ["Budget & Forecast", "/finance-os/budget-forecast", "The multi-year plan model"],
  ]],
  ["Dashboards", [
    ["All dashboards", "/dashboards", "The seven specialist views"],
    ["Management Accounts", "/finance-os/management-accounts", "Consolidated P&L — Xero actuals"],
    ["Cash Flow", "/finance-os/cashflow", "Cash position by entity"],
    ["Store Sales & KPI", "/finance-os/store-sales", "Trading across every store"],
    ["Store League", "/finance-os/store-sales/league", "Ranked by YTD net sales"],
    ["Store Drilldown", "/finance-os/store-sales/store", "One store in depth"],
    ["Store Break-even", "/finance-os/store-sales/break-even", "Above / below the line"],
    ["Inventory", "/finance-os/inventory", "Stock value, ageing & cover"],
    ["Franchise", "/finance-os/franchise", "Sales, receivables & credit"],
    ["Fixed Assets", "/finance-os/fixed-assets", "The asset register"],
  ]],
  ["Operate", [
    ["Forecast inputs", "/operate/forecast", "Stores · head office · franchise forecasts"],
    ["Management accounts close", "/operate/management-close", "Pre-close checks & the reconciliation playbook"],
    ["Intercompany", "/operate/intercompany", "Cash · inventory & recharges · disbursements"],
  ]],
  ["Workflow", [
    ["My Finance Week", "/perform/my-week", "Your tasks this week"],
    ["Team Schedule", "/perform/schedule", "Workload & allocation"],
    ["Review queue", "/perform/review", "Approve or return submitted work"],
    ["Month-end close", "/operate/month-end", "Per-entity close checklist"],
    ["Task library", "/perform/library", "Recurring templates"],
  ]],
  ["AI Control Tower", [
    ["Agent Centre", "/ai", "Governed finance agents"],
    ["AI review queue", "/ai/review", "Outputs awaiting a person"],
  ]],
  ["Govern", [
    ["Users & roles", "/govern/users", "Access control"],
    ["Entities", "/govern/entities", "The group's legal entities"],
    ["Action Centre", "/govern/actions", "Follow-through on decisions"],
    ["Benefits", "/govern/benefits", "Realised value"],
    ["Handbook", "/handbook", "The operating manual"],
  ]],
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const items = useMemo(() => {
    const flat = [];
    for (const [group, entries] of NAV) for (const [label, href, hint] of entries) flat.push({ group, label, href, hint });
    flat.push({ group: "Actions", label: "Switch light / dark theme", hint: "Appearance", run: () => {
      const el = document.documentElement;
      const light = el.getAttribute("data-theme") === "light";
      if (light) { el.removeAttribute("data-theme"); try { localStorage.setItem("fos-theme", "dark"); } catch {} }
      else { el.setAttribute("data-theme", "light"); try { localStorage.setItem("fos-theme", "light"); } catch {} }
    }});
    flat.push({ group: "Actions", label: "Sign out", hint: "End this session", run: async () => {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
      router.push("/login"); router.refresh();
    }});
    const needle = q.trim().toLowerCase();
    if (!needle) return flat;
    return flat.filter((it) => (it.label + " " + it.group + " " + (it.hint || "")).toLowerCase().includes(needle));
  }, [q, router]);

  const close = useCallback(() => { setOpen(false); setQ(""); setSel(0); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setSel(0); }
      else if (e.key === "Escape") close();
    };
    const onOpen = () => { setOpen(true); setQ(""); setSel(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("fos:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("fos:palette", onOpen); };
  }, [close]);

  useEffect(() => { if (open) { document.body.style.overflow = "hidden"; setTimeout(() => inputRef.current?.focus(), 10); } else { document.body.style.overflow = ""; } }, [open]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  function run(it) {
    close();
    if (it.run) it.run();
    else if (it.href) router.push(it.href);
  }

  function onInputKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); run(items[sel]); }
  }

  let lastGroup = null;

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,7,6,.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh", animation: "fosRise .18s var(--ease) both" }}>
      <div className="fos-glass" role="dialog" aria-modal="true" aria-label="Command palette"
        style={{ width: "min(620px, 92vw)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-pop)", overflow: "hidden",
          animation: "fosRise .22s var(--ease) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--glass-line)" }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", flex: "none" }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
            placeholder="Where to? Type a dashboard, task or action…" aria-label="Search commands"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--ink)", fontSize: 15.5, letterSpacing: "-.01em" }} />
          <span className="fos-kbd">esc</span>
        </div>
        <div ref={listRef} style={{ maxHeight: "46vh", overflowY: "auto", padding: "6px 6px 8px" }}>
          {items.length === 0 && (
            <div style={{ padding: "22px 16px", fontSize: 13.5, color: "var(--faint)" }}>Nothing matches “{q}”.</div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            const on = i === sel;
            return (
              <div key={`${it.group}-${it.label}`}>
                {header && <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", padding: "10px 12px 4px" }}>{header}</div>}
                <button data-i={i} onClick={() => run(it)} onMouseMove={() => setSel(i)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 12px",
                    borderRadius: 9, border: "none", background: on ? "var(--accent-bg)" : "transparent",
                    color: on ? "var(--ink)" : "var(--muted)", transition: "background .1s" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 550, color: "var(--ink)" }}>{it.label}</span>
                  <span style={{ fontSize: 12, color: "var(--faint)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.hint}</span>
                  {on && <span aria-hidden="true" style={{ fontSize: 12, color: "var(--accent)" }}>↵</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "9px 16px", borderTop: "1px solid var(--glass-line)", fontSize: 11, color: "var(--faint)" }}>
          <span><span className="fos-kbd">↑↓</span> navigate</span>
          <span><span className="fos-kbd">↵</span> open</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", letterSpacing: ".08em", textTransform: "uppercase", fontSize: 9.5 }}>Finance OS</span>
        </div>
      </div>
    </div>
  );
}
