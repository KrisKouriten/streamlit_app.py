import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getRealCashPosition, getRealCashByEntity, getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, EntityScopeBanner, Badge, Bar, money } from "../ui";

export const dynamic = "force-dynamic";

// Cash & Treasury on the real feed: consolidated cash across connected Xero
// entities, with the per-entity breakdown. Facility lines and forward cashflow
// movements await a treasury feed.
export default async function CashFlow() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [cash, byEntity, scope] = await Promise.all([getRealCashPosition(), getRealCashByEntity(), getConnectedEntities()]);
  const maxCash = byEntity.reduce((m, r) => Math.max(m, Math.abs(Number(r.available_cash) || 0)), 0);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Treasury" title="Cash Flow" right={cash ? "Xero cash position" : "Awaiting Xero feed"} />
      <EntityScopeBanner scope={scope} asAt={cash?.calendar_date} />

      {!cash ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          No Xero cash position loaded yet. Connect and load a Xero organisation to see the consolidated cash position here.
        </div>
      ) : (
        <>
          <StatRow>
            <Stat label="Cash at bank" value={money(cash.available_cash, { compact: true })} sub="Xero, connected entities" />
            <Stat label="Facility headroom" value={Number(cash.total_headroom) ? money(cash.total_headroom, { compact: true }) : "—"} sub={Number(cash.total_headroom) ? "undrawn committed" : "no facility on feed"} />
            <Stat label="Facility drawn" value={Number(cash.facility_limit) ? money(cash.facility_used, { compact: true }) : "—"} sub="on connected entities" />
            <Stat label="Bank recs" value={cash.all_reconciled ? "Clean" : "Open items"} tone={cash.all_reconciled ? "green" : "amber"} />
          </StatRow>

          {byEntity.length > 0 && (
            <Panel title="Cash by entity" note="reconciled bank balance, connected Xero entities">
              <Table
                columns={[
                  { label: "Entity", render: (r) => r.entity_name },
                  { label: "Cash at bank", align: "right", render: (r) => money(r.available_cash) },
                  { label: "", align: "right", render: (r) => <Bar value={r.available_cash} max={maxCash} /> },
                  { label: "Headroom", align: "right", render: (r) => (Number(r.headroom) ? money(r.headroom) : "—") },
                  { label: "Recs", align: "right", render: (r) => <Badge tone={r.all_reconciled ? "green" : "amber"}>{r.all_reconciled ? "Clean" : "Open"}</Badge> },
                ]}
                rows={byEntity}
              />
            </Panel>
          )}

          <Panel title="Treasury notes">
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              Cash is the reconciled bank balance from the connected Xero entities. Bank facilities and forward
              cashflow movements (committed and expected) are a treasury arrangement, not held in Xero — they will
              populate when the treasury feed is connected. Until then only the real cash position is shown.
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
