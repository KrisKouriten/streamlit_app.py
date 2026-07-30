import { redirect } from "next/navigation";
import { getSession, isAdmin } from "../../../lib/auth";
import { listPos, getDepartments, marketingCampaignSuggestions } from "../../../lib/purchase-orders";
import { getStoreList } from "../../../lib/store-sales";
import { listSignoffs, getPoSelfApproveLimit } from "../../../lib/governance";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import PoUI from "./po-ui";

export const dynamic = "force-dynamic";

// Purchase Order Requests (PLAN — HO) — departments raise a P.O (header + optional
// store recharge) after generating the number in Xero, then submit it for the
// department-head sign-off. A department's sign-off approvers (or an admin) can
// approve/reject; once signed off a P.O can only be deleted by an admin. Finance
// then closes or challenges it on the P.O Summary + Close screen (Operate).
export default async function PurchaseOrderRequests() {
  const session = await getSession();
  if (!session) redirect("/login");

  const admin = isAdmin(session);
  const email = (session.email || "").toLowerCase();

  const [list, departments, stores, signoffs, marketingCampaigns, selfApproveLimit] = await Promise.all([
    listPos({ limit: 100 }),
    getDepartments(),
    getStoreList().catch(() => []),
    listSignoffs().catch(() => []),
    marketingCampaignSuggestions().catch(() => []),
    getPoSelfApproveLimit().catch(() => 0),
  ]);

  // Departments this user can sign off for (from governance.department_signoff).
  // Admins can sign off any department, so this list is only consulted for
  // non-admins on the client.
  const approverDepts = signoffs
    .filter((s) => (s.signoff_email || "").toLowerCase() === email)
    .map((s) => s.department);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — HO" title="Purchase Order Requests"
        right="Raise a P.O, take it through department-head sign-off" />
      {!list.ready ? (
        <EmptyState title="One migration to run">
          Purchase Order Requests needs migration <span style={{ fontFamily: "var(--mono)" }}>046_purchase_order.sql</span> (idempotent). Run it, refresh, then raise your first P.O.
        </EmptyState>
      ) : (
        <PoUI
          initialPos={list.pos}
          departments={departments.map((d) => d.department_name)}
          stores={stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name }))}
          me={session.email || session.name}
          isAdmin={admin}
          approverDepts={approverDepts}
          marketingCampaigns={marketingCampaigns}
          selfApproveLimit={selfApproveLimit}
        />
      )}
    </div>
  );
}
