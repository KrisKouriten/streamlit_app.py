import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getCashPosition, getCashFlows } from "../../../lib/finance-os";
import { PageHeader, StatRow, Stat, Panel, Table, money } from "../ui";

export const dynamic = "force-dynamic";

export default async function CashFlow() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [positions, flows] = await Promise.all([getCashPosition(), getCashFlows()]);
  const cash = positions.reduce((s, r) => s + Number(r.available_cash || 0), 0);
  const headroom = positions.reduce((s, r) => s + Number(r.total_headroom || 0), 0);
  const facilityUsed = positions.reduce((s, r) => s + Number(r.facility_used || 0), 0);
  const reconciled = positions.every((r) => r.all_accounts_reconciled);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operational intelligence" title="Cash Flow & Treasury" right="Latest position" />

      <StatRow>
        <Stat label="Available cash" value={money(cash, { compact: true })} />
        <Stat label="Facility headroom" value={money(headroom, { compact: true })} tone="green" />
        <Stat label="Facility drawn" value={money(facilityUsed, { compact: true })} />
        <Stat label="Bank recs" value={reconciled ? "Clean" : "Open items"} tone={reconciled ? "green" : "amber"} />
      </StatRow>

      <Panel title="Bank & facility position" note="by entity">
        <Table
          columns={[
            { label: "Entity", render: (r) => r.entity_name },
            { label: "Available cash", align: "right", render: (r) => money(r.available_cash) },
            { label: "Facility limit", align: "right", render: (r) => money(r.facility_limit) },
            { label: "Drawn", align: "right", render: (r) => money(r.facility_used) },
            { label: "Headroom", align: "right", tone: "green", render: (r) => money(r.total_headroom) },
            { label: "Reconciled", align: "right", render: (r) => (r.all_accounts_reconciled ? "Yes" : "No") },
          ]}
          rows={positions}
        />
      </Panel>

      <Panel title="Cash flow this period" note="committed and expected movements">
        <Table
          columns={[
            { label: "Category", render: (r) => r.cashflow_category },
            { label: "Detail", render: (r) => r.cashflow_subcategory || "—" },
            { label: "Amount", align: "right",
              tone: (r) => (Number(r.amount_gbp) >= 0 ? "green" : "red"),
              render: (r) => money(r.amount_gbp) },
            { label: "Basis", align: "right", render: (r) => (r.committed_flag ? "Committed" : "Expected") },
          ]}
          rows={flows}
        />
      </Panel>
    </div>
  );
}
