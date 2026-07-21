import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getSkuAnalysis } from "../../../lib/sku";
import { PageHeader } from "../ui";
import SkuUI from "./sku-ui";

export const dynamic = "force-dynamic";

// SKU analysis — three lenses: 80/20 sellers (Pareto), new-SKU performance,
// dormant SKUs. Runs on a per-SKU metrics table; CSV-uploadable.
export default async function SkuAnalysis() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const data = await getSkuAnalysis();
  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Dashboards" title="SKU Analysis"
        right={data.loaded ? `As at ${data.asOf} · ${data.count} SKUs` : "Awaiting SKU data"} />
      <SkuUI data={data} canManage={canManage} />
    </div>
  );
}
