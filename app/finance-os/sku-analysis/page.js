import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getSkuReport } from "../../../lib/sku-report";
import { PageHeader } from "../ui";
import SkuReportUI from "./sku-report-ui";

export const dynamic = "force-dynamic";

// SKU Analysis Dashboard — renders the distributed analyses (Top 80 / Bottom 20
// now; Dormant once its summary is uploaded), ingested from the workbooks.
export default async function SkuAnalysis({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const sp = await searchParams;
  const tab = sp?.tab === "dormant" ? "dormant" : "top80";
  const top80 = await getSkuReport("top80");
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Dashboards · Merchandising" title="SKU Analysis Dashboard"
        right={top80.loaded ? (top80.period || "Top 80 / Bottom 20") : "Awaiting SKU data"} />
      <SkuReportUI tab={tab} top80={top80} canManage={canManage} />
    </div>
  );
}
