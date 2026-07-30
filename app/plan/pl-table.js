"use client";

import { money } from "../finance-os/ui";

/* Shared P&L renderer for the planning screens. Takes a getScopePL() payload
   ({ cols, rows, unmapped, formatName }) — the rows already rendered through the
   governed pl_format template — and draws the table, so the Plan P&L preview and
   the Budget/Forecast Builder present a scope identically. */

export default function PnlTable({ pnl, emptyHint }) {
  if (!pnl) return null;
  const { cols = [], rows = [], unmapped = [], formatName } = pnl;
  const hasData = rows.some((r) => r.kind !== "section" && r.kind !== "sub" && Math.abs(r.total || 0) > 0.005);

  return (
    <>
      {unmapped.length > 0 && (
        <div className="fos-card" style={{ padding: "12px 16px", marginBottom: 14, fontSize: 12.5, color: "var(--red)", lineHeight: 1.55 }}>
          <strong>{unmapped.length} nominal{unmapped.length === 1 ? "" : "s"} unmapped</strong> — computed by the engine but not claimed by any
          template line, so excluded from the P&L: <span style={{ fontFamily: "var(--mono)" }}>{unmapped.join(", ")}</span>.
          {" "}Map them in GOVERN → P&L Format Builder, or align the driver's nominal to a template account.
        </div>
      )}
      {!hasData && (
        <div className="fos-card" style={{ padding: "14px 18px", marginBottom: 14, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          {emptyHint || "No computed plan lines for this version, scenario and scope yet."}
        </div>
      )}
      <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
          <thead><tr>
            <th style={thL}>{formatName ? `${formatName} P&L` : "P&L"}</th>
            {cols.map((c) => <th key={c} style={thR}>{c}</th>)}
            <th style={thR}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => <PnlRow key={`${r.label}-${i}`} r={r} cols={cols} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PnlRow({ r, cols }) {
  if (r.kind === "section" || r.kind === "sub") {
    return <tr><td colSpan={cols.length + 2} style={{ padding: r.kind === "section" ? "12px 12px 5px 16px" : "8px 12px 4px 24px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{r.label}</td></tr>;
  }
  const tone = r.tone === "ebitda" ? (r.total >= 0 ? "var(--green)" : "var(--red)") : (r.tone === "gp" ? "var(--accent)" : undefined);
  const fmt = (v) => r.isPct ? `${(v * 100).toFixed(1)}%` : (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  return (
    <tr>
      <td style={tdL(r.strong || !!r.tone)}>{r.label}</td>
      {cols.map((c) => <td key={c} className="fos-num" style={tdR({ strong: r.strong, tone })}>{fmt(r.values?.[c])}</td>)}
      <td className="fos-num" style={tdR({ strong: true, tone })}>{fmt(r.total)}</td>
    </tr>
  );
}

const thL = { textAlign: "left", padding: "9px 12px 9px 16px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--surface)" };
const thR = { textAlign: "right", padding: "9px 12px", color: "var(--faint)", fontWeight: 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdL = (strong) => ({ textAlign: "left", padding: "7px 12px 7px 16px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: "var(--ink)", position: "sticky", left: 0, background: "var(--surface)" });
const tdR = ({ strong, tone } = {}) => ({ textAlign: "right", padding: "7px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: strong ? 650 : 400, color: tone || "var(--ink)" });
