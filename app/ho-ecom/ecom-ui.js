import Link from "next/link";
import { money, pct } from "../finance-os/ui";

/* Shared pieces for the HO-ECOM pages. Server-rendered. The header links back
   to HO-ECOM rather than Dashboards — an ECOM user is kept to this section. */

export const ECOM_NAV = [
  ["/ho-ecom", "Dashboard"],
  ["/ho-ecom/trading", "Daily trading"],
  ["/ho-ecom/pnl", "P&L, fees & marketing"],
];

export function EcomHeader({ title, right }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "0.5rem 0 1.4rem", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>
          <Link href="/ho-ecom" style={{ textDecoration: "none", color: "var(--faint)" }}>HO — ECOM</Link>
        </div>
        <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em", lineHeight: 1.15 }}>{title}</div>
      </div>
      {right && <div style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 3 }}>{right}</div>}
    </header>
  );
}

// "+4.2%" / "−3.1%" / "—"
export const signedPct = (v, dp = 1) => (v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(dp)}%`);
export const toneOf = (v, favourableUp = true) => (v == null ? undefined : (favourableUp ? v >= 0 : v <= 0) ? "var(--green)" : "var(--red)");
export const gbp2 = (v) => (v == null ? "—" : `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const dec = (v, dp = 2) => (v == null ? "—" : Number(v).toFixed(dp));
export const whole = (v) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-GB"));
export { money, pct };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ymLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const dmy = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

// A KPI tile: label, value, and an optional comparison line.
export function Tile({ label, value, sub, subTone, tone }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{label}</div>
      <div className="fos-num" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1, color: tone || "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: subTone || "var(--faint)", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export function Tiles({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>{children}</div>;
}

// A month picker (GET form), for the pages that read one month or one year.
export function PeriodPicker({ name, value, options, label, render = (v) => v }) {
  return (
    <form method="get" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <select name={name} defaultValue={value} style={{ height: 32, fontSize: 13, padding: "0 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}>
        {options.map((o) => <option key={o} value={o}>{render(o)}</option>)}
      </select>
      <button type="submit" className="fos-btn-ghost" style={{ height: 32 }}>Show</button>
    </form>
  );
}
