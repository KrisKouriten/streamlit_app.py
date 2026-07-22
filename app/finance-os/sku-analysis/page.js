import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getSkuReport, getNewSkuReport, getDormantReport } from "../../../lib/sku-report";
import { PageHeader } from "../ui";
import SkuReportUI from "./sku-report-ui";

export const dynamic = "force-dynamic";

// SKU Analysis Dashboard — the distributed analyses, ingested from the
// workbooks: Top 80 / Bottom 20, New SKU (newness), and Dormant (awaiting).
export default async function SkuAnalysis({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const sp = await searchParams;
  const tab = ["top80", "newsku", "dormant"].includes(sp?.tab) ? sp.tab : "top80";
  const top80 = tab === "top80" ? await getSkuReport("top80") : null;
  const newsku = tab === "newsku" ? await getNewSkuReport() : null;
  const dormant = tab === "dormant" ? await getDormantReport() : null;
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Dashboards · Merchandising" title="SKU Analysis Dashboard"
        right={top80?.loaded ? (top80.period || "Top 80 / Bottom 20") : "Merchandising analysis"} />
      <SkuReportUI tab={tab} top80={top80} newsku={newsku} dormant={dormant} canManage={canManage} />
    </div>
  );
}
