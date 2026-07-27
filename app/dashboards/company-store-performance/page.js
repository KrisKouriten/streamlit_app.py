import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/auth";
import { getWindows, getStoreLeague, getBreakEven } from "../../../lib/store-sales";
import { getScopePnl } from "../../../lib/joiin-entity";
import { PageHeader, StatRow, Stat, Panel, Table, Bar, ProvenanceBadge, EntityScopeBanner, money, num, pct, dateLabel, varianceTone } from "../../finance-os/ui";
import { getConnectedEntities } from "../../../lib/finance-os";
import PerspectivePanel from "../../perspective-panel";

export const dynamic = "force-dynamic";

/*
 * Company Store Performance Dashboard — own-store P&L and trading, in depth and
 * store-by-store. Read-only and driven end to end by governed feeds:
 *   • Own-store P&L to EBITDA — the per-entity Joiin P&L (each own store is a
 *     legal entity), consolidated to the store scope.
 *   • Store trading league + break-even — the store sales feed.
 * Each half three-states independently so a missing feed reads honestly rather
 * than as zeros.
 */

// Pull a headline P&L row by label (case-insensitive), preferring a valued
// total/calc row over a bare section header. Returns the row (label + total) so
// the tile can show the line's own name — honest whether the format calls the
// bottom line "EBITDA", "Operating Profit" or "Net Profit".
function headlineRow(rows, re) {
  if (!rows) return null;
  return rows.find((r) => r.label && re.test(r.label) && (r.kind === "total" || r.kind === "calc")) ||
         rows.find((r) => r.label && re.test(r.label) && r.values) || null;
}

export default async function CompanyStorePerformance() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [win, pnl, scope] = await Promise.all([
    getWindows(),
    getScopePnl({ scope: "store" }),
    getConnectedEntities().catch(() => null),
  ]);
  const [league, breakEven] = win
    ? await Promise.all([getStoreLeague(win.ytd), getBreakEven()])
    : [[], []];

  const revRow = pnl.loaded ? headlineRow(pnl.rows, /revenue|turnover/i) : null;
  const gpRow = pnl.loaded ? headlineRow(pnl.rows, /gross profit/i) : null;
  const profitRow = pnl.loaded ? headlineRow(pnl.rows, /ebitda|operating profit|net profit/i) : null;
  const revenue = revRow?.total ?? null;
  const grossProfit = gpRow?.total ?? null;
  const profit = profitRow?.total ?? null;
  const profitLabel = profitRow?.label || "Operating profit";

  const maxNet = Math.max(1, ...league.map((r) => Number(r.net) || 0));
  const box = { fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px", marginBottom: 20 };

  return (
    <div className="fos-shell">
      <PageHeader crumb="Dashboards · Own-store performance" title="Company Store Performance Dashboard"
        right={win ? `Store data to ${dateLabel(win.maxDate)}` : pnl.loaded ? `Own-store P&L · ${pnl.year}` : "Awaiting feeds"} />

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="company-store-performance" pageName="Company Store Performance" />
      </div>

      {/* ---- Own-store P&L headline (Joiin per-entity, consolidated to stores) ---- */}
      <Panel title="Own-store P&L" note={pnl.loaded ? `consolidated · ${pnl.year}` : undefined}>
        {!pnl.ready ? (
          <div style={box}>Run migration <span style={{ fontFamily: "var(--mono)" }}>021</span> and load the per-entity P&L (Perform → Management Accounts).</div>
        ) : !pnl.loaded ? (
          <div style={box}>No per-entity P&L loaded yet — refresh it under <strong>Perform → Management Accounts</strong>.</div>
        ) : (
          <>
            {scope?.kind === "JOIIN" && <EntityScopeBanner scope={scope} asAt={scope.asAt} />}
            <StatRow>
              <Stat label="Revenue" value={money(revenue, { compact: true })} sub={`Own stores · ${pnl.year}`} />
              <Stat label="Gross profit" value={money(grossProfit, { compact: true })} sub={grossProfit != null && revenue ? pct(grossProfit / revenue) + " margin" : "—"} />
              <Stat label={profitLabel} value={money(profit, { compact: true })} sub={profit != null && revenue ? pct(profit / revenue) + " of revenue" : "—"} tone={profit != null ? (profit >= 0 ? "green" : "red") : undefined} />
              <Stat label="Stores in scope" value={num((pnl.storeList?.length || 1) - 1)} sub="Own-store legal entities" />
            </StatRow>
            <div style={{ fontSize: 12, color: "var(--faint)", margin: "-14px 0 8px" }}>
              Full line-by-line P&L by store is on the <Link href="/dashboards/management-accounts?view=overview">Management Accounts Dashboard</Link> (Store scope).
            </div>
          </>
        )}
      </Panel>

      {/* ---- Store trading league (store sales feed) ---- */}
      <Panel title="Store trading league" note={win ? "net sales · year to date" : undefined}>
        {!win ? (
          <div style={box}>The store trading feed isn&#39;t loaded in this environment yet — the league and break-even populate once store sales data is connected.</div>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}><ProvenanceBadge kind="feed" /></div>
            <Table
              columns={[
                { label: "Store", render: (r) => r.store_name },
                { label: "Net sales", align: "right", render: (r) => money(r.net, { compact: true }) },
                { label: "", render: (r) => <Bar value={r.net} max={maxNet} /> },
                { label: "GM %", align: "right", render: (r) => (r.net ? pct((Number(r.gm) || 0) / Number(r.net)) : "—") },
                { label: "Transactions", align: "right", render: (r) => num(r.trans) },
                { label: "YoY net", align: "right", tone: (r) => varianceTone(r.py_net ? (r.net - r.py_net) : null),
                  render: (r) => (r.py_net ? pct((r.net - r.py_net) / r.py_net) : "—") },
              ]}
              rows={league}
              empty="No store sales in the current year-to-date window."
            />
          </>
        )}
      </Panel>

      {/* ---- Break-even ---- */}
      {win && breakEven.length > 0 && (
        <Panel title="Break-even" note="year to date · actual vs break-even">
          <Table
            columns={[
              { label: "Store", render: (r) => r.store_name },
              { label: "YTD actual", align: "right", render: (r) => money(r.ytd_actual, { compact: true }) },
              { label: "Break-even", align: "right", render: (r) => money(r.ytd_break_even, { compact: true }) },
              { label: "Headroom", align: "right", tone: (r) => varianceTone((Number(r.ytd_actual) || 0) - (Number(r.ytd_break_even) || 0)),
                render: (r) => money((Number(r.ytd_actual) || 0) - (Number(r.ytd_break_even) || 0), { compact: true }) },
            ]}
            rows={breakEven}
          />
        </Panel>
      )}

      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 4, maxWidth: "82ch", lineHeight: 1.6 }}>
        Own-store P&L is the governed Joiin per-entity feed consolidated across own-store entities. Trading and break-even come from the store sales feed. All figures are read-only — driven by the upstream flow, not keyed here.
      </div>
    </div>
  );
}
