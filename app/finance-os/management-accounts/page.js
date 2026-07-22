import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getScopePnl } from "../../../lib/joiin-entity";
import { PageHeader, money } from "../ui";
import McControls from "./mc-controls";

export const dynamic = "force-dynamic";

const SCOPE_NOTE = {
  store: "Company-owned store actuals in the Store board-pack format. Toggle the year, or scroll each store or the consolidation.",
  head_office: "Head Office / wholesale actuals. Toggle the year.",
  franchise: "Franchise actuals in the Franchise board-pack format. Toggle the year.",
  consolidated: "All group nominals consolidated, per the Consolidated format. Toggle the year.",
};
const TAB_LABEL = { store: "Store", head_office: "Head Office", franchise: "Franchise", consolidated: "Consolidated" };

// Management Accounts — a four-tab board-pack workbook (Store · Head Office ·
// Franchise · Consolidated). Each tab renders the governed P&L format against
// Joiin actuals, filtered to a year; the Store tab scrolls each entity or the
// consolidation. Refreshed from Joiin (GOVERN → P&L Formats → upload).
export default async function ManagementAccounts({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const tab = ["store", "head_office", "franchise", "consolidated"].includes(sp?.tab) ? sp.tab : "store";

  const data = await getScopePnl({ scope: tab, entity: sp?.store, year: sp?.year });

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Perform · Financial reporting" title="Management Accounts"
        right={data.loaded ? `${TAB_LABEL[tab]} · actuals` : "Awaiting Joiin actuals"} />

      {!data.ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migrations <span style={{ fontFamily: "var(--mono)" }}>021</span> and <span style={{ fontFamily: "var(--mono)" }}>022</span>, then load the Joiin by-company P&L.
        </div>
      ) : !data.loaded ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No per-entity actuals loaded yet — upload the Joiin by-company P&L under <strong>Govern → P&L Formats</strong>.
        </div>
      ) : (
        <>
          <McControls tab={tab} years={data.years} year={data.year} storeList={data.storeList} store={data.selected} />
          <div style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 12px", maxWidth: "76ch" }}>
            {SCOPE_NOTE[tab]}
            {data.usingGeneric && <span style={{ color: "var(--amber, #b8860b)" }}> — showing a detailed nominal layout; upload the {TAB_LABEL[tab]} format under Govern → P&L Formats for the board-pack view.</span>}
            {" "}Internal management reporting — review before any external use.
          </div>
          <BoardPackPnl entity={{ months: data.months, rows: data.rows, label: data.label }} />
        </>
      )}
    </div>
  );
}

// Server-rendered board-pack P&L for the selected entity. Months across + total.
function BoardPackPnl({ entity }) {
  const { months, rows, label } = entity;
  const fmtMonth = (m) => { const [y, mo] = m.split("-"); return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo]} ${y.slice(2)}`; };
  const cellMoney = (v) => (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  const cellPct = (v) => (v ? `${(v * 100).toFixed(1)}%` : "·");
  const th = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: strong ? 700 : 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", ...(r ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: 18 }) });

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
        <thead><tr>
          <th style={th(false)}>{label}</th>
          {months.map((m) => <th key={m} style={th(true)}>{fmtMonth(m)}</th>)}
          <th style={th(true, true)}>Total</th>
        </tr></thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "section") return (
              <tr key={i}><td colSpan={months.length + 2} style={{ padding: "12px 12px 4px 18px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{row.label}</td></tr>
            );
            if (row.kind === "sub") return (
              <tr key={i}><td colSpan={months.length + 2} style={{ padding: "7px 12px 3px 26px", fontSize: 11.5, fontStyle: "italic", color: "var(--muted)", position: "sticky", left: 0, background: "var(--surface)" }}>{row.label}</td></tr>
            );
            const isTotal = row.kind === "total" || row.kind === "calc";
            const strong = row.strong || isTotal;
            const tone = row.tone && ((row.total || 0) >= 0 ? "var(--green)" : "var(--red)");
            const top = row.kind === "calc" || row.strong;
            const td = (r, opts = {}) => ({ textAlign: r ? "right" : "left", padding: "6px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", borderTop: top ? "1px solid var(--line)" : undefined, fontWeight: strong ? 650 : 400, color: opts.tone || (row.isPct ? "var(--muted)" : row.kind === "line" ? "var(--ink)" : "var(--ink)"), ...(r ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: row.kind === "line" ? 26 : 18 }) });
            const fmt = row.isPct ? cellPct : cellMoney;
            return (
              <tr key={i}>
                <td style={td(false)}>{row.label}</td>
                {months.map((m) => <td key={m} style={td(true, { tone: row.tone && ((row.values[m] || 0) >= 0 ? "var(--green)" : "var(--red)") })}>{fmt(row.values[m])}</td>)}
                <td style={td(true, { tone })}>{fmt(row.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
