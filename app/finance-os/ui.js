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
  green: "var(--green)", amber: "var(--amber)", red: "#a32d2d", muted: "var(--muted)",
};

export function PageHeader({ crumb, title, right }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>
          <Link href="/finance-os" style={{ textDecoration: "none", color: "var(--faint)" }}>Finance OS</Link> · {crumb}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      </div>
      {right && <div style={{ fontSize: 13, color: "var(--muted)" }}>{right}</div>}
    </header>
  );
}

export function StatRow({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 26 }}>{children}</div>;
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1, color: tone ? TONE[tone] : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, note, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
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
    <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 520 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ textAlign: c.align || "left", padding: "10px 14px", color: "var(--faint)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
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
                  <td key={ci} style={{
                    textAlign: c.align || "left", padding: "10px 14px",
                    borderBottom: ri === rows.length - 1 ? "none" : "1px solid var(--line)",
                    color: tone ? TONE[tone] : "var(--ink)", whiteSpace: "nowrap",
                    fontVariantNumeric: c.align === "right" ? "tabular-nums" : "normal",
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
    <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
      {items.map(([href, label]) => {
        const on = href === active;
        return (
          <Link key={href} href={href} style={{
            fontSize: 12.5, padding: "5px 12px", borderRadius: 7, textDecoration: "none",
            border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
            background: on ? "var(--accent-bg)" : "transparent",
            color: on ? "var(--accent)" : "var(--muted)",
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
