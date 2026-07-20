import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
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
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const [groupPl, stores, monthly, breakeven, kpi, xero, scope, loaded] = await Promise.all([
    getGroupPL(), getStores(), getStoreMonths(), getBreakeven(), getKpi(),
    getRealFinanceSnapshot(), getConnectedEntities(), planLoaded(),
  ]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Strategic planning · Budget & Forecast" title="Budget & Forecast"
        right={loaded ? "Plan 2025A–2028B" : "Awaiting plan upload"} />
      <BudgetForecastUI
        groupPl={groupPl} stores={stores} monthly={monthly} breakeven={breakeven} kpi={kpi}
        xero={xero} scope={scope} canManage={canManage} loaded={loaded} />
    </div>
  );
}
