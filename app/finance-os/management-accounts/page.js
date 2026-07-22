import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getScopePnl } from "../../../lib/joiin-entity";
import { getBoardPack } from "../../../lib/joiin-boardpack";
import { PageHeader, money } from "../ui";
import McControls from "./mc-controls";

export const dynamic = "force-dynamic";

const SCOPE_NOTE = {
  store: "Company-owned store actuals in the Store board-pack format. Toggle the year, or scroll each store or the consolidation.",
  head_office: "Head Office / wholesale actuals in the Head Office board-pack format. Toggle the year.",
  franchise: "Franchise actuals in the Franchise board-pack format. Toggle the year.",
  consolidated: "All group nominals consolidated, per the Consolidated format. Toggle the year.",
};
const TAB_LABEL = { store: "Store", head_office: "Head Office", franchise: "Franchise", consolidated: "Consolidated" };
const PERIODS = ["current", "trailing", "ytd"];

const monthLabel = (m) => { const [y, mo] = m.split("-"); return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo]} ${y.slice(2)}`; };

// Reshape the board-pack rows for the chosen reporting period. The data is
// monthly, so: "current" shows just the latest month; "trailing" shows every
// loaded month of the year with a summing Total; "ytd" collapses the year into
// one cumulative column. Money rows sum; % rows blank on any aggregate column
// (a summed margin would be meaningless) — same rule the Total column already used.
function applyPeriod({ months, rows, year }, period) {
  const sorted = [...months].sort();
  const sumMoney = (r, keys) => (r.isPct ? null : keys.reduce((t, m) => t + (r.values[m] || 0), 0));

  if (period === "current") {
    const m = sorted[sorted.length - 1];
    const cols = m ? [{ key: m, label: monthLabel(m) }] : [];
    return { cols, showTotal: false, rows: rows.map((r) => ({ ...r, total: null })) };
  }
  if (period === "ytd") {
    const K = "__ytd__";
    const cols = [{ key: K, label: `YTD ${year}` }];
    return { cols, showTotal: false, rows: rows.map((r) => ({ ...r, values: { [K]: sumMoney(r, sorted) }, total: null })) };
  }
  // trailing (default multi-month view)
  const cols = sorted.map((m) => ({ key: m, label: monthLabel(m) }));
  return { cols, showTotal: true, rows: rows.map((r) => ({ ...r, total: sumMoney(r, sorted) })) };
}

// Resolve a tab's data. Board-pack tabs (and the store consolidation) render
// Joiin's own custom-report board pack — Joiin does the arithmetic and the
// intercompany wholesale elimination, so we render it verbatim. An individual
// store scrolls the per-entity standalone P&L. When a scope's board pack isn't
// loaded yet we fall back to the per-entity data so the tab still shows actuals.
async function resolveTab(tab, storeParam, year) {
  if (tab === "store") {
    const scoped = await getScopePnl({ scope: "store", entity: storeParam, year });
    if (!scoped.ready) return { ready: false };
    if (!scoped.loaded) return { ready: true, loaded: false };
    const isAll = scoped.storeList && scoped.selected === scoped.storeList[0].key;
    if (isAll) {
      const bp = await getBoardPack("store", year);
      if (bp.loaded) return { ready: true, loaded: true, source: "boardpack", years: bp.years, year: bp.year, months: bp.months, rows: bp.rows, label: "All stores — consolidated", storeList: scoped.storeList, selected: scoped.selected };
    }
    // individual store (or store board pack not loaded) — per-entity standalone
    return { ready: true, loaded: true, source: scoped.usingGeneric ? "generic" : "entity", years: scoped.years, year: scoped.year, months: scoped.months, rows: scoped.rows, label: scoped.label, storeList: scoped.storeList, selected: scoped.selected, usingGeneric: scoped.usingGeneric };
  }

  const bp = await getBoardPack(tab, year);
  if (bp.loaded) return { ready: true, loaded: true, source: "boardpack", years: bp.years, year: bp.year, months: bp.months, rows: bp.rows, label: TAB_LABEL[tab] };
  const scoped = await getScopePnl({ scope: tab, year });
  if (!scoped.ready) return { ready: false };
  if (!scoped.loaded) return { ready: true, loaded: false };
  return { ready: true, loaded: true, source: scoped.usingGeneric ? "generic" : "entity", years: scoped.years, year: scoped.year, months: scoped.months, rows: scoped.rows, label: scoped.label, usingGeneric: scoped.usingGeneric };
}

// Management Accounts — a four-tab board-pack workbook (Store · Head Office ·
// Franchise · Consolidated). Each tab renders Joiin's own custom-report board
// pack (wholesale intercompany eliminated by Joiin), filtered to a year; the
// Store tab scrolls each entity or the consolidation. Refreshed from Joiin
// (GOVERN → P&L Formats → Refresh, or the scheduled custom-report pull).
export default async function ManagementAccounts({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const tab = ["store", "head_office", "franchise", "consolidated"].includes(sp?.tab) ? sp.tab : "store";
  const period = PERIODS.includes(sp?.period) ? sp.period : "current";

  const data = await resolveTab(tab, sp?.store, sp?.year);
  const view = data.loaded ? applyPeriod(data, period) : null;

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Perform · Financial reporting" title="Management Accounts"
        right={data.loaded ? `${TAB_LABEL[tab]} · actuals` : "Awaiting Joiin actuals"} />

      <McControls tab={tab} years={data.years || []} year={data.year} period={period} storeList={data.storeList} store={data.selected} />

      {!data.ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migrations <span style={{ fontFamily: "var(--mono)" }}>021</span>–<span style={{ fontFamily: "var(--mono)" }}>023</span>, then refresh from Joiin.
        </div>
      ) : !data.loaded ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No {TAB_LABEL[tab]} actuals loaded yet — pull the board pack under <strong>Govern → P&L Formats → Refresh from Joiin</strong>.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 12px", maxWidth: "80ch" }}>
            {SCOPE_NOTE[tab]}
            {data.source === "boardpack" && <span> Rendered from Joiin&rsquo;s own board pack — intercompany wholesale sales eliminated by Joiin.</span>}
            {data.source === "generic" && <span style={{ color: "var(--amber, #b8860b)" }}> — showing a detailed nominal layout; refresh the {TAB_LABEL[tab]} board pack from Joiin for the laid-out view.</span>}
            {" "}Internal management reporting — review before any external use.
          </div>
          <BoardPackPnl cols={view.cols} rows={view.rows} label={data.label} showTotal={view.showTotal} />
        </>
      )}
    </div>
  );
}

// Server-rendered board-pack P&L. Columns are the chosen period's periods
// (one for current/ytd, several for trailing); Total appears only when showTotal.
function BoardPackPnl({ cols, rows, label, showTotal }) {
  const cellMoney = (v) => (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  const cellPct = (v) => (v ? `${(v * 100).toFixed(1)}%` : "·");
  const span = cols.length + 1 + (showTotal ? 1 : 0);
  const th = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: strong ? 700 : 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", ...(r ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: 18 }) });

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
        <thead><tr>
          <th style={th(false)}>{label}</th>
          {cols.map((c) => <th key={c.key} style={th(true)}>{c.label}</th>)}
          {showTotal && <th style={th(true, true)}>Total</th>}
        </tr></thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "section") return (
              <tr key={i}><td colSpan={span} style={{ padding: "12px 12px 4px 18px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{row.label}</td></tr>
            );
            if (row.kind === "sub") return (
              <tr key={i}><td colSpan={span} style={{ padding: "7px 12px 3px 26px", fontSize: 11.5, fontStyle: "italic", color: "var(--muted)", position: "sticky", left: 0, background: "var(--surface)" }}>{row.label}</td></tr>
            );
            const isTotal = row.kind === "total" || row.kind === "calc";
            const strong = row.strong || isTotal;
            const tone = row.tone && ((row.total || 0) >= 0 ? "var(--green)" : "var(--red)");
            const top = row.kind === "calc" || row.strong;
            const td = (r, opts = {}) => ({ textAlign: r ? "right" : "left", padding: "6px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", borderTop: top ? "1px solid var(--line)" : undefined, fontWeight: strong ? 650 : 400, color: opts.tone || (row.isPct ? "var(--muted)" : "var(--ink)"), ...(r ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: row.kind === "line" ? 26 : 18 }) });
            const fmt = row.isPct ? cellPct : cellMoney;
            return (
              <tr key={i}>
                <td style={td(false)}>{row.label}</td>
                {cols.map((c) => <td key={c.key} style={td(true, { tone: row.tone && ((row.values[c.key] || 0) >= 0 ? "var(--green)" : "var(--red)") })}>{fmt(row.values[c.key])}</td>)}
                {showTotal && <td style={td(true, { tone })}>{fmt(row.total)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
