import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getProcurement } from "../../../lib/procurement";
import { PageHeader } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";
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
    <div className="fos-shell">
      <PageHeader crumb="Operate" title="Procurement"
        right={pr.loaded ? "Cash budget vs committed spend" : "Awaiting purchases"} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="procurement" pageName="Procurement" />
      </div>
      <ProcurementUI data={pr.summary} ready={pr.ready} loaded={pr.loaded} illustrative={pr.illustrative} canManage={canManage} />
    </div>
  );
}
