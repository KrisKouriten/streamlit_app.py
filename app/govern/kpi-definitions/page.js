import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listKpis } from "../../../lib/kpi";
import { PageHeader } from "../../finance-os/ui";
import KpiAdmin from "./kpi-admin";

export const dynamic = "force-dynamic";

// KPI Definitions master (Tier 3.4) — the governed catalogue behind every
// dashboard metric: name, calculation, unit, favourable direction, thresholds
// and owners. ADMIN/FINANCE master these; every change is audited.
export default async function KpiDefinitions() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const kpis = await listKpis();

  return (
    <div className="fos-shell">
      <PageHeader crumb="Finance Data" title="KPI Definitions" right={`${kpis.length} governed KPI${kpis.length === 1 ? "" : "s"}`} />
      <KpiAdmin kpis={kpis} canManage={canManage} />
    </div>
  );
}
