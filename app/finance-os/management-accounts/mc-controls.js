"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Tab bar + year toggle + (store scope) entity scroller for the board-pack
// Management Accounts. Navigates via ?tab / ?year / ?store, scroll preserved.
const TABS = [
  { key: "store", label: "Store" },
  { key: "head_office", label: "Head Office" },
  { key: "franchise", label: "Franchise" },
  { key: "consolidated", label: "Consolidated" },
];

const PERIOD_OPTS = [
  { key: "current", label: "Current month" },
  { key: "trailing", label: "Trailing months" },
  { key: "ytd", label: "YTD" },
];

export default function McControls({ tab, years, year, period, storeList, store }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (patch) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null) sp.delete(k); else sp.set(k, v); }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  // Download the full board pack (all four scopes) as Excel, for the year and
  // period currently in view. A plain link so the browser handles the download.
  const exportHref = `/api/management-accounts/export?period=${period}${year ? `&year=${year}` : ""}`;
  // Print-clean view of the full pack (→ browser Save as PDF), opened in a new tab.
  const printHref = `/finance-os/management-accounts/print?period=${period}${year ? `&year=${year}` : ""}`;

  const storeIdx = storeList ? storeList.findIndex((s) => s.key === store) : -1;
  const step = (d) => { const n = storeList[(storeIdx + d + storeList.length) % storeList.length]; go({ store: n.key }); };

  const tabBtn = (active) => ({
    padding: "8px 16px", fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
    background: "none", border: "none", color: active ? "var(--ink)" : "var(--faint)",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1,
  });
  const pill = (active) => ({
    padding: "4px 12px", fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: "pointer",
    borderRadius: 20, border: "1px solid " + (active ? "var(--accent)" : "var(--line)"),
    background: active ? "var(--accent-bg, rgba(180,150,60,.12))" : "transparent", color: active ? "var(--ink)" : "var(--muted)",
  });

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => <button key={t.key} style={tabBtn(t.key === tab)} onClick={() => go({ tab: t.key, store: null })}>{t.label}</button>)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="fos-eyebrow" style={{ margin: 0 }}>Period</span>
            {PERIOD_OPTS.map((p) => <button key={p.key} style={pill(p.key === period)} onClick={() => go({ period: p.key })}>{p.label}</button>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="fos-eyebrow" style={{ margin: 0 }}>Year</span>
            {years.length ? years.map((y) => <button key={y} style={pill(y === year)} onClick={() => go({ year: y })}>{y}</button>)
              : <span style={{ fontSize: 12, color: "var(--faint)" }}>no data</span>}
          </div>
          {years.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <a href={exportHref} style={{ ...pill(false), textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }} title="Download the full board pack (all scopes) as Excel">
                <span aria-hidden>⤓</span> Excel
              </a>
              <a href={printHref} target="_blank" rel="noopener" style={{ ...pill(false), textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }} title="Open a print-clean board pack to Save as PDF">
                <span aria-hidden>⎙</span> PDF
              </a>
            </div>
          )}
        </div>
        {tab === "store" && storeList && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button aria-label="Previous store" style={{ ...pill(false), padding: "4px 10px" }} onClick={() => step(-1)}>‹</button>
            <select className="fos-input" value={store} onChange={(e) => go({ store: e.target.value })} style={{ fontSize: 12.5, maxWidth: 280 }} aria-label="Select store">
              {storeList.map((s) => <option key={s.key} value={s.key}>{s.display}</option>)}
            </select>
            <button aria-label="Next store" style={{ ...pill(false), padding: "4px 10px" }} onClick={() => step(1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}
