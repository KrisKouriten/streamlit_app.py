import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { canExport } from "../../../lib/reporting/report-access-rules";
import { getForecast } from "../../../lib/forecast";
import { computeNominalPnl, SCOPES } from "../../../lib/forecast-rules.js";
import { PageHeader, RelatedRail } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";
import ForecastUI from "./forecast-ui";

export const dynamic = "force-dynamic";

// Operate forecast inputs — the workings from the store forecast workbook:
// forecast sales per store, variable rates (% of sales), fixed schedules, and
// the head office & franchise monthly P&Ls. The full nominal build (sales →
// EBITDA) is shown per scope, and per store when one is selected.
export default async function OperateForecast({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const requestedStore = typeof sp.store === "string" ? sp.store : null;

  const fc = await getForecast();

  let payload = null;
  if (fc.loaded) {
    // Full nominal P&L per scope (aggregate), computed server-side.
    const nominalByScope = {};
    for (const scope of Object.keys(SCOPES)) nominalByScope[scope] = computeNominalPnl(fc.lines, { scope });

    // If a valid store is selected, its own full nominal P&L.
    const storeSet = new Set(fc.storeSales.map((s) => s.store));
    const selectedStore = requestedStore && storeSet.has(requestedStore) ? requestedStore : null;
    const storePnl = selectedStore ? computeNominalPnl(fc.lines, { scope: "STORES", unit: selectedStore }) : null;

    payload = {
      months: fc.base.months,
      group: fc.base.group,
      scopeTotals: Object.fromEntries(Object.entries(fc.base.byScope).map(([k, v]) => [k, v.totals])),
      nominalByScope,
      storePnl,
      selectedStore,
      storeSales: fc.storeSales.map(({ store, sales }) => ({ store, sales })),
      counts: fc.counts,
    };
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Operate" title="Forecast inputs"
        right={fc.loaded ? "Company stores · Head office · Franchise" : "Awaiting forecast load"} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="forecast" pageName="Forecast Builder"
          filters={{ store: (payload && payload.selectedStore) || undefined }} />
      </div>
      <RelatedRail links={[
        { label: "Scenario Planning", href: "/plan/scenarios" },
        { label: "Budget & Forecast", href: "/finance-os/budget-forecast" },
        { label: "Management Accounts", href: "/finance-os/management-accounts" },
        { label: "Departmental Budgets", href: "/plan/dept-budget" },
      ]} />
      <ForecastUI data={payload} ready={fc.ready} canManage={canManage} canExport={canExport(session)} />
    </div>
  );
}
