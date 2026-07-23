import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getProcurement } from "../../../lib/procurement";
import { PageHeader } from "../../finance-os/ui";
import ProcurementUI from "./procurement-ui";

export const dynamic = "force-dynamic";

// Procurement — Miniso purchases and local purchases, with the monthly cash
// budget control: supplier payment terms decide the cash-out month, so the
// merch team see committed spend landing against each month's cash budget.
export default async function Procurement() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE", "OPS");
  const pr = await getProcurement();

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operate" title="Procurement"
        right={pr.loaded ? "Cash budget vs committed spend" : "Awaiting purchases"} />
      <ProcurementUI data={pr.summary} ready={pr.ready} loaded={pr.loaded} illustrative={pr.illustrative} canManage={canManage} />
    </div>
  );
}
