import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getManagementAccounts } from "../../../lib/management-accounts";
import { getJoiinPnl } from "../../../lib/joiin";
import { PageHeader, money } from "../ui";
import MaUI from "./ma-ui";

export const dynamic = "force-dynamic";

// Management Accounts — store-level P&L from the uploaded actuals workbook,
// blended with the forecast (actuals lead each month they cover, forecast carries
// forward, budget = frozen forecast), then the Joiin consolidated group P&L.
export default async function ManagementAccounts() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const [ma, joiin] = await Promise.all([getManagementAccounts(), getJoiinPnl()]);

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
