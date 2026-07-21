import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getForecast } from "../../../lib/forecast";
import { PageHeader } from "../../finance-os/ui";
import ForecastUI from "./forecast-ui";

export const dynamic = "force-dynamic";

// Operate forecast inputs — the workings from the Q3 forecast models: forecast
// sales per store, variable rates (% of sales), fixed schedules, and the head
// office & franchise monthly P&Ls. PLAN's scenario planning runs on these inputs.
export default async function OperateForecast() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const fc = await getForecast();

  // Pass compact aggregates to the client, not the 5k raw lines.
  const payload = fc.loaded ? {
    months: fc.base.months,
    byScope: Object.fromEntries(Object.entries(fc.base.byScope).map(([k, v]) => [k, { months: v.months, totals: v.totals }])),
    group: fc.base.group,
    storeSales: fc.storeSales,
    byEntity: fc.byEntity,
    counts: fc.counts,
  } : null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operate" title="Forecast inputs"
        right={fc.loaded ? "Company stores · Head office · Franchise" : "Awaiting forecast load"} />
      <ForecastUI data={payload} ready={fc.ready} canManage={canManage} />
    </div>
  );
}
