import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { resolveAllTabs } from "../../../../lib/ma-boardpack-view";
import { applyPeriod, PERIOD_LABEL } from "../../../../lib/ma-export-rules";
import { money } from "../../ui";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

const PERIODS = ["current", "trailing", "ytd"];

// Print-clean board pack — all four scopes stacked, one per page, for the
// chosen year and period. The app shell is .no-print, so the browser's
// Print → Save as PDF produces a clean board-pack PDF. Rendered from the same
// resolveAllTabs + applyPeriod path as the screen and the Excel export.
export default async function ManagementAccountsPrint({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const year = sp?.year || null;
  const period = PERIODS.includes(sp?.period) ? sp.period : "current";

  const tabs = await resolveAllTabs(year);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Board pack ready to print — use <strong>Print → Save as PDF</strong>. Each scope prints on its own page.
        </div>
        <PrintButton />
      </div>

      {!tabs.length ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)" }}>
          No Management Accounts actuals loaded yet — pull the board packs from Joiin first.
        </div>
      ) : (
        tabs.map(({ tab, label, data }) => {
          const view = applyPeriod(data, period);
          return (
            <section key={tab} className="fos-print-tab" style={{ marginBottom: 30 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--faint)", fontFamily: "var(--mono)" }}>Miniso UK — Management Accounts</div>
                <h2 style={{ fontSize: 19, fontWeight: 700, margin: "3px 0 1px" }}>{label}</h2>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{PERIOD_LABEL[period]} · {data.year}</div>
              </div>
              <PrintTable view={view} label={label} />
              <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 8 }}>
                Internal management reporting — review before any external use.
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function PrintTable({ view, label }) {
  const money0 = (v) => (v == null || Math.round(v) === 0 ? "–" : money(v));
  const pct = (v) => (v ? `${(v * 100).toFixed(1)}%` : "–");
  const cols = view.cols;
  const span = cols.length + 1 + (view.showTotal ? 1 : 0);

  const thL = { textAlign: "left", padding: "6px 10px", fontSize: 10.5, fontWeight: 700, borderBottom: "1.5px solid var(--ink)", whiteSpace: "nowrap" };
  const thR = { ...thL, textAlign: "right" };

  return (
    <table className="fos-print-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
      <thead>
        <tr>
          <th style={thL}>{label}</th>
          {cols.map((c) => <th key={c.key} style={thR}>{c.label}</th>)}
          {view.showTotal && <th style={thR}>Total</th>}
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, i) => {
          if (row.kind === "section") {
            return <tr key={i}><td colSpan={span} style={{ padding: "10px 10px 3px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>{row.label}</td></tr>;
          }
          if (row.kind === "sub") {
            return <tr key={i}><td colSpan={span} style={{ padding: "6px 10px 2px 22px", fontStyle: "italic", fontSize: 11.5, color: "var(--muted)" }}>{row.label}</td></tr>;
          }
          const isTotal = row.kind === "total" || row.kind === "calc";
          const strong = row.strong || isTotal;
          const fmt = row.isPct ? pct : money0;
          const td = { textAlign: "right", padding: "4px 10px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", borderTop: isTotal ? "1px solid var(--line-strong)" : undefined, fontWeight: strong ? 700 : 400 };
          const tdL = { ...td, textAlign: "left", paddingLeft: row.kind === "line" ? 22 : 10 };
          return (
            <tr key={i} className={isTotal ? "fos-total" : undefined}>
              <td style={tdL}>{row.label}</td>
              {cols.map((c) => <td key={c.key} style={td}>{fmt(row.values?.[c.key])}</td>)}
              {view.showTotal && <td style={td}>{fmt(row.total)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
