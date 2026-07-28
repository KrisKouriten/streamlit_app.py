"use client";
import PerspectivePanel from "./perspective-panel";
import AddToReport from "./add-to-report";

/*
 * PageIntel — the standard "page intelligence" action set + connected rail, so
 * every page offers the same four things in the same place:
 *   · AI Perspective   (only when the page is a governed-eligible pageId)
 *   · Ask Finance Buddy (always — opens the buddy panel via the fos:buddy event)
 *   · Add to Report     (when the page exposes a report source)
 *   · Related           (a row of cross-page links)
 * Pure chrome; all governed work happens server-side in the components it wraps.
 */
export default function PageIntel({ pageId = null, pageName = "this page", filters = null, report = null, related = [], buddy = true }) {
  const links = (related || []).filter((l) => l && l.href && l.label);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {pageId && <PerspectivePanel pageId={pageId} pageName={pageName} filters={filters} />}
        {buddy && (
          <button onClick={() => { try { window.dispatchEvent(new Event("fos:buddy")); } catch {} }}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--ink)", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }}>
            <span aria-hidden="true">✦</span> Ask Finance Buddy
          </button>
        )}
        {report && <AddToReport {...report} />}
      </div>
      {links.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", flex: "none" }}>Related</span>
          {links.map((l) => (
            <a key={l.href} href={l.href} style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", textDecoration: "none", padding: "5px 11px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)" }}>{l.label} →</a>
          ))}
        </div>
      )}
    </div>
  );
}
