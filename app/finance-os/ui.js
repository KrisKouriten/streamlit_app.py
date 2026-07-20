import Link from "next/link";

/* Shared presentational pieces for the Finance OS dashboards. Server-rendered,
   no client JS. Currency follows Miniso UK house style: £ with comma thousands
   separators; compact (£m / £k) for headline tiles, full pounds in tables. */

export function money(n, { compact = false } = {}) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
    if (abs >= 1_000) return `${sign}£${Math.round(abs / 1000).toLocaleString("en-GB")}k`;
  }
  return `${sign}£${Math.round(abs).toLocaleString("en-GB")}`;
}

export function pct(n, dp = 1) {
  if (n === null || n === undefined) return "—";
  return `${(Number(n) * 100).toFixed(dp)}%`;
}

export function num(n) {
  if (n === null || n === undefined) return "—";
  return Math.round(Number(n)).toLocaleString("en-GB");
}

export function dateLabel(d) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";
}

const TONE = {
  green: "var(--green)", amber: "var(--amber)", red: "var(--red)", muted: "var(--muted)",
};

export function PageHeader({ crumb, title, right }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "0.5rem 0 1.9rem", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          <Link href="/dashboards" style={{ textDecoration: "none", color: "var(--faint)" }}>Dashboards</Link> · {crumb}
        </div>
        <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em", lineHeight: 1.15 }}>{title}</div>
      </div>
      {right && <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 3 }}>{right}</div>}
    </header>
  );
}

export function StatRow({ children }) {
  return <div className="fos-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 30 }}>{children}</div>;
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="fos-card" style={{ padding: "15px 17px 14px" }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 9 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 27, fontWeight: 650, lineHeight: 1, letterSpacing: "-.025em", color: tone ? TONE[tone] : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, note, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      {title && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
          <div style={{ fontSize: 14.5, fontWeight: 650, letterSpacing: "-.015em" }}>{title}</div>
          {note && <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· {note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// columns: [{ label, align?, tone?, render:(row)=>value }]
export function Table({ columns, rows, empty = "No data." }) {
  if (!rows || rows.length === 0) {
    return <div style={{ fontSize: 13.5, color: "var(--faint)", padding: "12px 0" }}>{empty}</div>;
  }
  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 520 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ textAlign: c.align || "left", padding: "11px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((c, ci) => {
                const tone = typeof c.tone === "function" ? c.tone(row) : c.tone;
                return (
                  <td key={ci} className={c.align === "right" ? "fos-num" : undefined} style={{
                    textAlign: c.align || "left", padding: "10.5px 16px",
                    borderBottom: ri === rows.length - 1 ? "none" : "1px solid var(--hairline)",
                    color: tone ? TONE[tone] : "var(--ink)", whiteSpace: "nowrap",
                  }}>
                    {c.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubNav({ items, active }) {
  return (
    <div style={{ display: "inline-flex", gap: 3, marginBottom: 24, flexWrap: "wrap", padding: 3, background: "var(--raise)", border: "1px solid var(--line)", borderRadius: 10 }}>
      {items.map(([href, label]) => {
        const on = href === active;
        return (
          <Link key={href} href={href} style={{
            fontSize: 12.5, fontWeight: on ? 600 : 500, padding: "6px 13px", borderRadius: 7, textDecoration: "none",
            background: on ? "var(--surface)" : "transparent",
            boxShadow: on ? "var(--shadow-1)" : "none",
            border: `1px solid ${on ? "var(--line-strong)" : "transparent"}`,
            color: on ? "var(--ink)" : "var(--muted)",
            transition: "color var(--t-fast) var(--ease), background var(--t-fast) var(--ease)",
          }}>{label}</Link>
        );
      })}
    </div>
  );
}

export const STORE_SALES_NAV = [
  ["/finance-os/store-sales", "Executive view"],
  ["/finance-os/store-sales/league", "Store league"],
  ["/finance-os/store-sales/store", "Store drilldown"],
  ["/finance-os/store-sales/break-even", "Break-even"],
];

export function varianceTone(v, favourableUp = true) {
  if (v === null || v === undefined) return "muted";
  const good = favourableUp ? Number(v) >= 0 : Number(v) <= 0;
  return good ? "green" : "red";
}

const BADGE_FG = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", accent: "var(--accent)", muted: "var(--muted)" };
const BADGE_BG = { green: "var(--green-bg)", amber: "var(--amber-bg)", red: "var(--red-bg)", accent: "var(--accent-bg)", muted: "var(--raise)" };

// Small uppercase pill. tone ∈ green|amber|red|accent|muted.
export function Badge({ tone = "muted", children }) {
  return (
    <span style={{
      display: "inline-block", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: ".06em", color: BADGE_FG[tone], background: BADGE_BG[tone],
      border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", lineHeight: 1.2,
    }}>{children}</span>
  );
}

// Data-provenance badge — makes "is this real?" legible on every dashboard.
// kind ∈ xero | feed | model | illustrative.
const PROVENANCE = {
  xero: ["accent", "Real · Xero feed"],
  feed: ["accent", "Real · governed feed"],
  model: ["accent", "Real · uploaded model"],
  illustrative: ["amber", "Illustrative · no live feed"],
};
export function ProvenanceBadge({ kind }) {
  const [tone, label] = PROVENANCE[kind] || PROVENANCE.illustrative;
  return <Badge tone={tone}>{label}</Badge>;
}

// Inline proportional bar for tables / mini-charts. Renders |value| against max.
export function Bar({ value, max, tone = "accent", width = 88 }) {
  const w = max ? Math.max(0, Math.min(100, (Math.abs(Number(value)) / Math.abs(max)) * 100)) : 0;
  const color = BADGE_FG[tone] || "var(--accent)";
  return (
    <span style={{ display: "inline-block", width, height: 7, background: "var(--raise)", borderRadius: 4, overflow: "hidden", verticalAlign: "middle", boxShadow: "inset 0 1px 1px rgba(0,0,0,.18)" }}>
      <span style={{ display: "block", width: `${w}%`, height: "100%", borderRadius: 4,
        background: `linear-gradient(90deg, color-mix(in srgb, ${color} 62%, transparent), ${color})`,
        transition: "width var(--t-slow) var(--ease)" }} />
    </span>
  );
}

// Amber "this is illustrative" banner — the honesty device for no-feed dashboards.
// Mirrors EntityScopeBanner so real and illustrative dashboards read as one family.
export function IllustrativeBanner({ children }) {
  return (
    <div style={{ background: "linear-gradient(135deg, var(--amber-bg), color-mix(in srgb, var(--amber-bg) 45%, var(--surface)))", border: "1px solid color-mix(in srgb, var(--amber) 30%, var(--line))", borderRadius: "var(--radius)", boxShadow: "var(--card-top)", padding: "10px 14px", marginBottom: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase", letterSpacing: ".08em", marginRight: 8 }}>Illustrative data</span>
      {children}
    </div>
  );
}

// Consolidation-scope banner for the real Xero finance dashboards. Makes the
// partial feed explicit: which entities are live and as at when. Shown whenever
// a page reports real statutory finance so no one reads it as the whole group.
export function EntityScopeBanner({ scope, asAt }) {
  const joiin = scope?.kind === "JOIIN";
  const count = scope?.count || 0;
  const names = (scope?.entities || []).filter((e) => e.feed_status === "CONNECTED").map((e) => e.entity_name).join(", ");
  const empty = !joiin && count === 0;
  return (
    <div style={{ background: "linear-gradient(135deg, var(--accent-bg), color-mix(in srgb, var(--accent-bg) 45%, var(--surface)))", border: "1px solid color-mix(in srgb, var(--accent-deep) 55%, var(--line))", borderRadius: "var(--radius)", boxShadow: "var(--card-top)", padding: "10px 14px", marginBottom: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink)" }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: ".08em", marginRight: 8 }}>
        {joiin ? "Real feed · Joiin" : "Real Xero feed"}
      </span>
      {joiin ? (
        <span>
          Consolidated across the full group — {count} companies via Joiin, intercompany eliminations applied
          {asAt ? ` · as at ${dateLabel(asAt)}` : ""}.
        </span>
      ) : empty ? (
        <span>No Xero organisation is connected yet — connect one to populate these figures.</span>
      ) : (
        <span>
          Consolidated across {count} connected {count === 1 ? "entity" : "entities"}{names ? ` — ${names}` : ""}
          {asAt ? ` · as at ${dateLabel(asAt)}` : ""}. Connect further Xero organisations to consolidate the full Miniso&nbsp;UK group.
        </span>
      )}
    </div>
  );
}
