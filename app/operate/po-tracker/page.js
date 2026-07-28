import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { listPos, getDepartments } from "../../../lib/purchase-orders";
import { getStoreList } from "../../../lib/store-sales";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import PoUI from "./po-ui";

export const dynamic = "force-dynamic";

// Purchase Order Tracker (OPERATE) — departments raise a P.O (header + optional
// store recharge) after generating the number in Xero, then submit it for the
// department-head sign-off. Percentages must total 100% before sign-off.
export default async function POTracker() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [list, departments, stores] = await Promise.all([
    listPos({ limit: 100 }),
    getDepartments(),
    getStoreList().catch(() => []),
  ]);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Operate" title="Purchase Order Tracker"
        right="Raise a P.O, tag the department and recharge to stores" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          The Purchase Order Tracker needs migration <span style={{ fontFamily: "var(--mono)" }}>046_purchase_order.sql</span> (idempotent). Run it, refresh, then raise your first P.O.
        </EmptyState>
      ) : (
        <PoUI
          initialPos={list.pos}
          departments={departments.map((d) => d.department_name)}
          stores={stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name }))}
          me={session.email || session.name}
        />
      )}
    </div>
  );
}
