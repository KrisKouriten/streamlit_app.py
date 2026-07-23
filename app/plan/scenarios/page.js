import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getForecast } from "../../../lib/forecast";
import ScenariosUI from "./scenarios-ui";

export const dynamic = "force-dynamic";

// Scenario planning — levers over the Operate forecast inputs (forecast sales,
// variable rates, fixed costs). The maths is linear in the scope-month
// aggregates, so the client flexes them live without reloading.
export default async function Scenarios() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const fc = await getForecast();
  const payload = fc.loaded ? {
    months: fc.base.months,
    byScope: Object.fromEntries(Object.entries(fc.base.byScope).map(([k, v]) => [k, { months: v.months, totals: v.totals }])),
  } : null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ margin: "0.5rem 0 1.9rem" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 7 }}>Plan · Scenario planning</div>
        <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-.022em" }}>Scenario planning</div>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8, maxWidth: 680, lineHeight: 1.6 }}>
          Upside, base and downside on the Operate forecast inputs — flex forecast sales, variable rates and
          fixed costs, watch EBITDA move by month, and save the scenarios the group plans against.
        </p>
      </header>
      <ScenariosUI data={payload} ready={fc.ready} scenarios={fc.scenarios} canManage={canManage} />
    </div>
  );
}
