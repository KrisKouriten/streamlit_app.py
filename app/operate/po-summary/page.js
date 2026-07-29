import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listPos, getDepartments } from "../../../lib/purchase-orders";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import PoSummaryUI from "./po-summary-ui";

export const dynamic = "force-dynamic";

/*
 * P.O Summary + Close (OPERATE) — Finance's review desk. Every signed-off P.O
 * lands here: Finance records the invoice number and net amount, then either
 * CLOSES it (→ committed spend on the Departmental Budget Dashboard) or raises a
 * CHALLENGE under a controlled reason (→ shown "under challenge" on the dashboard
 * and the requests screen). All P.Os can be downloaded to Excel — with a per-store
 * allocation breakdown — selecting all or just the ticked rows.
 */
export default async function PoSummaryClose() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const [list, departments] = await Promise.all([
    listPos({ limit: 500 }),
    getDepartments().catch(() => []),
  ]);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Operate" title="P.O Summary + Close"
        right="Finance: record invoices, close or challenge purchase orders" />

      {!canManage ? (
        <EmptyState title="Finance only">
          The P.O Summary + Close desk is for Finance and administrators — it&rsquo;s where invoices are recorded and purchase orders are closed or challenged. Ask an administrator if you need access.
        </EmptyState>
      ) : !list.ready ? (
        <EmptyState title="One migration to run">
          This screen needs the purchase-order tables (migration <span style={{ fontFamily: "var(--mono)" }}>046</span>) and the finance-close columns (migration <span style={{ fontFamily: "var(--mono)" }}>052</span>). Run them, refresh, and signed-off P.Os will appear here.
        </EmptyState>
      ) : (
        <PoSummaryUI
          initialPos={list.pos}
          departments={departments.map((d) => d.department_name)}
        />
      )}
    </div>
  );
}
