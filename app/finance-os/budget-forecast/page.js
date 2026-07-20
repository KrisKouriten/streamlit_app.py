import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getRealPL, getRealFinanceSnapshot, getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, EntityScopeBanner, money, pct } from "../ui";

export const dynamic = "force-dynamic";

// Budget & Forecast on the real feed. Actuals are live from Xero; the budget and
// forecast come from the FY planning cycle, which is not yet loaded — shown as a
// pending state rather than illustrative numbers.
export default async function BudgetForecast() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [pl, snap, scope] = await Promise.all([getRealPL(), getRealFinanceSnapshot(), getConnectedEntities()]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Strategic planning" title="Budget & Forecast" right={snap ? "Actuals · plan pending" : "Awaiting Xero feed"} />
      <EntityScopeBanner scope={scope} asAt={snap?.asAt} />

      {!snap ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No Xero actuals loaded yet. Connect and load a Xero organisation to see actuals against plan here.
        </div>
      ) : (
        <>
          <StatRow>
            <Stat label="Revenue (actual)" value={money(snap.revenue, { compact: true })} sub="Xero actuals" />
            <Stat label="Gross margin (actual)" value={pct(snap.grossMargin)} sub={`${money(snap.grossProfit, { compact: true })} gross`} />
            <Stat label="Net result (actual)" value={money(snap.netResult, { compact: true })} tone={snap.netResult >= 0 ? "green" : "red"} sub="before tax" />
            <Stat label="Budget / forecast" value="Pending" tone="amber" sub="planning cycle not loaded" />
          </StatRow>

          <Panel title="Actuals by account" note="real Xero actuals; budget & forecast await the planning feed">
            <Table
              columns={[
                { label: "Account", render: (r) => r.account_name },
                { label: "Actual", align: "right", tone: (r) => (Number(r.amount) >= 0 ? "green" : undefined), render: (r) => money(r.amount) },
                { label: "Budget", align: "right", render: () => "—" },
                { label: "Forecast", align: "right", render: () => "—" },
              ]}
              rows={pl}
            />
          </Panel>

          <div style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.5 }}>
            Budget and forecast are intentionally blank until the FY planning cycle is loaded from a real source —
            no illustrative plan is shown.
          </div>
        </>
      )}
    </div>
  );
}
