import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { canExport } from "../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../lib/reporting/watermark";
import Restricted from "../../restricted";
import ScreenWatermark from "../../screen-watermark";
import { getGroupPL, getStores, getStoreMonths, getBreakeven, getKpi, planLoaded } from "../../../lib/plan";
import { getRealFinanceSnapshot, getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader } from "../ui";
import BudgetForecastUI from "./bf-ui";

export const dynamic = "force-dynamic";

// Budget & Forecast — plan-led (the multi-year model), with real Xero actuals
// shown alongside the group P&L for the entities that are connected.
export default async function BudgetForecast() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canExport(session)) return <Restricted title="Budget & Forecast" />;
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const [groupPl, stores, monthly, breakeven, kpi, xero, scope, loaded] = await Promise.all([
    getGroupPL(), getStores(), getStoreMonths(), getBreakeven(), getKpi(),
    getRealFinanceSnapshot(), getConnectedEntities(), planLoaded(),
  ]);

  return (
    <div className="fos-shell">
      <ScreenWatermark text={confidentialStamp(session, new Date())} />
      <PageHeader crumb="Planning" title="Budget & Forecast"
        right={loaded ? "Plan 2025A–2028B" : "Awaiting plan upload"} />
      <BudgetForecastUI
        groupPl={groupPl} stores={stores} monthly={monthly} breakeven={breakeven} kpi={kpi}
        xero={xero} scope={scope} canManage={canManage} loaded={loaded} />
    </div>
  );
}
