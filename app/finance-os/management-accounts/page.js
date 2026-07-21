import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getManagementAccounts } from "../../../lib/management-accounts";
import { getJoiinPnl } from "../../../lib/joiin";
import { getEntityPnl } from "../../../lib/joiin-entity";
import { PageHeader, money } from "../ui";
import MaUI from "./ma-ui";
import EntitySelect from "./entity-select";

export const dynamic = "force-dynamic";

// Management Accounts — store-level P&L from the uploaded actuals workbook,
// blended with the forecast (actuals lead each month they cover, forecast carries
// forward, budget = frozen forecast), then the Joiin consolidated group P&L and
// the per-entity board-pack P&L drill-down.
export default async function ManagementAccounts({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const sp = await searchParams;

  const [ma, joiin, entity] = await Promise.all([getManagementAccounts(), getJoiinPnl(), getEntityPnl(sp?.entity)]);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Financial reporting" title="Management Accounts"
        right={ma.loaded ? "Store actuals + forecast" : "Awaiting actuals"} />

      <MaUI data={ma} canManage={canManage} />

      <div style={{ margin: "34px 0 14px", borderTop: "1px solid var(--line)", paddingTop: 20 }}>
        <div className="fos-eyebrow">Consolidated group — Joiin</div>
        <div style={{ fontSize: 13, color: "var(--faint)", marginTop: 4 }}>
          Full consolidated P&L across all group companies, intercompany eliminations applied, refreshed from the Joiin connector.
        </div>
      </div>

      {!joiin.loaded ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          {joiin.ready
            ? "No Joiin data loaded yet — refresh the consolidated P&L from the Joiin connector."
            : <>Run migration <span style={{ fontFamily: "var(--mono)" }}>020_joiin_pl_detail.sql</span>, then load the Joiin consolidated P&L.</>}
        </div>
      ) : (
        <JoiinPnl joiin={joiin} />
      )}

      <div id="entity-pl" style={{ margin: "34px 0 14px", borderTop: "1px solid var(--line)", paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="fos-eyebrow">Entity P&L — board pack</div>
          <div style={{ fontSize: 13, color: "var(--faint)", marginTop: 4, maxWidth: 620 }}>
            Standalone P&L per entity in the board-pack format. Store entities and the company-store consolidation use the detailed store layout; other entities show a full nominal breakdown. Internal management reporting — review before any external use.
          </div>
        </div>
        {entity.loaded && <EntitySelect catalogue={entity.catalogue} selected={entity.selected} />}
      </div>

      {!entity.loaded ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          {entity.ready
            ? "No per-entity data loaded yet — refresh the by-company P&L from the Joiin connector."
            : <>Run migration <span style={{ fontFamily: "var(--mono)" }}>021_joiin_pl_entity.sql</span>, then load the by-company P&L.</>}
        </div>
      ) : (
        <BoardPackPnl entity={entity} />
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

// Server-rendered consolidated P&L: sections with subtotals + account detail,
// Gross Profit / Operating Profit / Net Profit derived. Months across, FY total.
function JoiinPnl({ joiin }) {
  const { months, sections, computed } = joiin;
  const cell = (v) => (v == null || Math.round(v) === 0 ? "·" : money(v, { compact: true }));
  const th = (r, strong) => ({ textAlign: r ? "right" : "left", padding: "9px 12px", color: "var(--faint)", fontWeight: strong ? 700 : 600, fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: "var(--mono)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap", ...(r ? {} : { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: 18 }) });
  const td = (o = {}) => ({ textAlign: o.r ? "right" : "left", padding: "6.5px 12px", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", fontWeight: o.strong ? 650 : 400, borderTop: o.top ? "1px solid var(--line)" : undefined, color: o.tone || (o.sub ? "var(--muted)" : "var(--ink)"), fontStyle: o.sub ? undefined : undefined, ...(o.sticky ? { position: "sticky", left: 0, background: "var(--surface)", paddingLeft: o.acc ? 26 : 18 } : {}) });
  const totalRow = (label, t, opts = {}) => (
    <tr>
      <td style={td({ sticky: true, strong: true, top: opts.top })}>{label}</td>
      {months.map((m) => <td key={m} style={td({ r: true, strong: true, top: opts.top, tone: opts.tone && ((t.months[m] || 0) >= 0 ? "var(--green)" : "var(--red)") })}>{cell(t.months[m])}</td>)}
      <td style={td({ r: true, strong: true, top: opts.top, tone: opts.tone && (t.total >= 0 ? "var(--green)" : "var(--red)") })}>{cell(t.total)}</td>
    </tr>
  );

  return (
    <div className="fos-card fos-tbl" style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
        <thead><tr>
          <th style={th(false)}>Consolidated P&L</th>
          {months.map((m) => <th key={m} style={th(true)}>{m}</th>)}
          <th style={th(true, true)}>Total</th>
        </tr></thead>
        <tbody>
          {sections.map((sec) => (
            <>
              <tr key={sec.name + "_h"}><td colSpan={months.length + 2} style={{ padding: "11px 12px 4px 18px", fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)", position: "sticky", left: 0, background: "var(--surface)" }}>{sec.name}</td></tr>
              {sec.rows.map((a) => (
                <tr key={sec.name + a.account}>
                  <td style={td({ sticky: true, acc: true })}>{a.account}</td>
                  {months.map((m) => <td key={m} style={td({ r: true, tone: "var(--muted)" })}>{cell(a.months[m])}</td>)}
                  <td style={td({ r: true, strong: true })}>{cell(a.total)}</td>
                </tr>
              ))}
              {totalRow(`Total ${sec.name}`, sec.total, { top: true })}
              {sec.name === "Cost of Sales" && totalRow("Gross Profit", computed.grossProfit, { top: true, tone: true })}
              {sec.name === "Expenses" && totalRow("Operating Profit", computed.operatingProfit, { top: true, tone: true })}
            </>
          ))}
          {totalRow("Net Profit", computed.netProfit, { top: true, tone: true })}
        </tbody>
      </table>
    </div>
  );
}
