"use client";

import { useMemo } from "react";
import { poBudgetByMonth } from "../../../lib/po-rules";
import { ALL_DEPTS } from "../../../lib/dept-tabs-rules.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const gbp = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}£${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-GB")}`);
const labelSt = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
const th = (right) => ({ ...labelSt, textAlign: right ? "right" : "left", padding: "7px 10px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" });
const td = (right, extra = {}) => ({ padding: "7px 10px", borderBottom: "1px solid var(--hairline)", textAlign: right ? "right" : "left", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...extra });
const tone = (v) => (v == null ? undefined : v < 0 ? "var(--red)" : "var(--green)");

/*
 * Spend & committed against budget, on Purchase Order Requests — for the
 * department's head and Finance. One department: its budget, committed and
 * open P.Os month by month (P.O date), the same figures as its Departmental
 * Budget dashboard. All departments: one line each.
 *   budgets   { [department]: { budgetMonths, card, version, status } }
 *   visible   the departments this person may see it for
 */
export default function PoBudget({ year, budgets = {}, visible = [], pos = [], dept }) {
  // All departments: those with a budget or a P.O; one department: just it.
  const shown = dept === ALL_DEPTS
    ? visible.filter((d) => budgets[d] || pos.some((p) => p.department === d))
    : visible.filter((d) => d === dept);
  const per = useMemo(() => Object.fromEntries(shown.map((d) => [d, poBudgetByMonth({
    year, pos: pos.filter((p) => p.department === d),
    budgetMonths: budgets[d]?.budgetMonths || null, card: budgets[d]?.card || 0,
  })])), [shown.join("|"), pos, budgets, year]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown.length) return null;

  const card = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", marginBottom: 16 };
  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>Spend &amp; committed vs budget · {year}</div>
      <div style={{ fontSize: 11.5, color: "var(--faint)" }}>
        committed = closed by Finance, or invoiced · open = not yet invoiced · by P.O date · net
      </div>
    </div>
  );

  if (shown.length > 1) {
    return (
      <div style={card}>
        {head}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>
              <th style={th()}>Department</th><th style={th(true)}>Budget</th><th style={th(true)}>Committed</th>
              <th style={th(true)}>Open P.Os</th><th style={th(true)}>Card / pre-approved</th><th style={th(true)}>Remaining</th><th style={th(true)}>Used</th>
            </tr></thead>
            <tbody>
              {shown.map((d) => {
                const t = per[d].totals;
                const used = t.budget ? (t.committed + t.open + t.card) / t.budget : null;
                return (
                  <tr key={d}>
                    <td style={td(false, { fontWeight: 600 })}>{d}</td>
                    <td style={td(true)}>{t.budget == null ? <span style={{ color: "var(--faint)" }}>no budget</span> : gbp(t.budget)}</td>
                    <td style={td(true)}>{gbp(t.committed)}</td>
                    <td style={td(true)}>{gbp(t.open)}</td>
                    <td style={td(true)}>{t.card ? gbp(t.card) : "—"}</td>
                    <td style={td(true, { color: tone(t.remaining), fontWeight: 600 })}>{gbp(t.remaining)}</td>
                    <td style={td(true, { color: used != null && used > 1 ? "var(--red)" : "var(--muted)" })}>{used == null ? "—" : `${Math.round(used * 100)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const d = shown[0];
  const r = per[d];
  const t = r.totals;
  const tile = (label, value, sub, color) => (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--raise)" }}>
      <div style={labelSt}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={card}>
      {head}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
        {tile("Budget", t.budget == null ? "—" : gbp(t.budget), t.budget == null ? "no budget for this year" : `${budgets[d]?.version || ""}`)}
        {tile("Committed", gbp(t.committed), "closed or invoiced")}
        {tile("Open P.Os", gbp(t.open), "not yet invoiced")}
        {t.card > 0 && tile("Card / pre-approved", gbp(t.card), "logged against the budget")}
        {tile("Remaining", gbp(t.remaining), t.remaining == null ? "" : t.remaining < 0 ? "over budget" : "budget less committed & open", tone(t.remaining))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>
            <th style={th()}>Month</th><th style={th(true)}>Budget</th><th style={th(true)}>Committed</th>
            <th style={th(true)}>Open P.Os</th><th style={th(true)}>Remaining</th>
          </tr></thead>
          <tbody>
            {r.months.filter((m) => m.budget || m.committed || m.open).map((m) => (
              <tr key={m.month}>
                <td style={td()}>{MONTHS[m.month - 1]} {year}</td>
                <td style={td(true)}>{gbp(m.budget)}</td>
                <td style={td(true)}>{m.committed ? gbp(m.committed) : "—"}</td>
                <td style={td(true)}>{m.open ? gbp(m.open) : "—"}</td>
                <td style={td(true, { color: tone(m.remaining) })}>{gbp(m.remaining)}</td>
              </tr>
            ))}
            {(r.other.committed > 0 || r.other.open > 0) && (
              <tr>
                <td style={td(false, { color: "var(--muted)" })} title="Live P.Os dated in another year">Other years</td>
                <td style={td(true)}>—</td>
                <td style={td(true)}>{r.other.committed ? gbp(r.other.committed) : "—"}</td>
                <td style={td(true)}>{r.other.open ? gbp(r.other.open) : "—"}</td>
                <td style={td(true)}>—</td>
              </tr>
            )}
            {t.card > 0 && (
              <tr>
                <td style={td(false, { color: "var(--muted)" })}>Card / pre-approved</td>
                <td style={td(true)}>—</td><td style={td(true)}>{gbp(t.card)}</td><td style={td(true)}>—</td><td style={td(true)}>—</td>
              </tr>
            )}
            <tr>
              <td style={td(false, { fontWeight: 700 })}>Total</td>
              <td style={td(true, { fontWeight: 700 })}>{gbp(t.budget)}</td>
              <td style={td(true, { fontWeight: 700 })}>{gbp(t.committed + t.card)}</td>
              <td style={td(true, { fontWeight: 700 })}>{gbp(t.open)}</td>
              <td style={td(true, { fontWeight: 700, color: tone(t.remaining) })}>{gbp(t.remaining)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
