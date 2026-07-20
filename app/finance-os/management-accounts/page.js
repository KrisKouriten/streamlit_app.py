import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getRealPL, getRealFinanceSnapshot, getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, EntityScopeBanner, Bar, money, pct } from "../ui";

export const dynamic = "force-dynamic";

// Management Accounts on the real Xero feed: the consolidated P&L (actuals) for
// the connected entities, shown as a structured P&L with % of revenue and a
// composition bar, then the full by-account detail. Budget/forecast comparatives
// await a real planning feed, so no variance is shown yet.
export default async function ManagementAccounts() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [pl, snap, scope] = await Promise.all([getRealPL(), getRealFinanceSnapshot(), getConnectedEntities()]);

  // Headline P&L structure, derived from the reconciled snapshot. COGS/opex are
  // held negative in the ledger; show magnitudes and keep gross profit / net bold.
  const rev = snap ? Number(snap.revenue) : 0;
  const structure = snap ? [
    { line: "Revenue", amount: snap.revenue, strong: false },
    { line: "Cost of sales", amount: snap.cogs, strong: false },
    { line: "Gross profit", amount: snap.grossProfit, strong: true },
    { line: "Operating costs", amount: snap.opex, strong: false },
    { line: "Net result", amount: snap.netResult, strong: true, tone: snap.netResult >= 0 ? "green" : "red" },
  ] : [];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Financial reporting" title="Management Accounts" right={snap ? "Xero actuals" : "Awaiting Xero feed"} />
      <EntityScopeBanner scope={scope} asAt={snap?.asAt} />

      {!snap ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No Xero actuals loaded yet. Once a Xero organisation is connected and loaded, the consolidated P&L appears here.
        </div>
      ) : (
        <>
          <StatRow>
            <Stat label="Revenue" value={money(snap.revenue, { compact: true })} sub="Xero actuals" />
            <Stat label="Gross profit" value={money(snap.grossProfit, { compact: true })} sub={`${pct(snap.grossMargin)} margin`} />
            <Stat label="Operating costs" value={money(Math.abs(snap.opex), { compact: true })} sub="excl. cost of sales" />
            <Stat label="Net result" value={money(snap.netResult, { compact: true })} tone={snap.netResult >= 0 ? "green" : "red"} sub="before tax" />
          </StatRow>

          <Panel title="Profit & loss" note="structure · % of revenue">
            <Table
              columns={[
                { label: "", render: (r) => <span style={{ fontWeight: r.strong ? 700 : 400 }}>{r.line}</span> },
                { label: "Amount", align: "right", tone: (r) => r.tone,
                  render: (r) => <span style={{ fontWeight: r.strong ? 700 : 400 }}>{money(r.amount)}</span> },
                { label: "% of revenue", align: "right", render: (r) => (rev ? pct(Math.abs(r.amount) / rev, 0) : "—") },
                { label: "", align: "right", render: (r) => <Bar value={r.amount} max={rev} tone={r.strong ? (r.tone || "accent") : "muted"} /> },
              ]}
              rows={structure}
            />
          </Panel>

          <Panel title="By account" note="real Xero actuals, by ledger account">
            <Table
              columns={[
                { label: "Account", render: (r) => r.account_name },
                { label: "Group", render: (r) => r.account_group },
                { label: "Amount", align: "right", tone: (r) => (Number(r.amount) >= 0 ? "green" : undefined), render: (r) => money(r.amount) },
              ]}
              rows={pl}
            />
          </Panel>

          <div style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.5 }}>
            Budget and forecast comparatives await the FY planning cycle — they are not yet loaded from a real source,
            so no variance is shown. Figures are consolidated across connected entities only.
          </div>
        </>
      )}
    </div>
  );
}
