import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listPlanVersions, listScenarios, listPlanStores, listSalesDriverInputs, getScopePL, createPlanVersion } from "../../../lib/planning";
import { PageHeader, RelatedRail } from "../../finance-os/ui";
import BuilderUI from "./builder-ui";

export const dynamic = "force-dynamic";

// The 12 months of a version's fiscal year (falls back to 2026 when unset).
function fyMonths(fy) {
  const y = Number(fy) || 2026;
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
}

/*
 * Budget / Forecast Builder — the driver entry over the planning engine. Same
 * screen for both: BUDGET vs FORECAST is just the plan version's kind. This first
 * cut is the store SALES driver build (footfall × conversion × ATV, or direct /
 * hybrid with a visible management adjustment); Compute runs sales + costs +
 * payroll into plan_line and the P&L below renders through the governed template.
 * Cost & payroll entry screens are the next increment.
 */
export default async function BudgetForecastBuilder({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const versions = await listPlanVersions();
  const scenarios = await listScenarios();

  const versionId = sp.version ? Number(sp.version) : (versions[0]?.version_id ?? null);
  const version = versions.find((v) => Number(v.version_id) === versionId) || null;
  const scenario = typeof sp.scenario === "string" && sp.scenario ? sp.scenario : (version?.base_scenario || "BASE");

  // Company stores only for the sales-driver build (the driver model is store retail sales).
  const stores = await listPlanStores({ scope: "COMPANY_STORE" });
  const storeCode = stores.some((s) => s.store_code === sp.store) ? sp.store : (stores[0]?.store_code ?? null);

  const months = fyMonths(version?.fiscal_year);
  let inputs = [];
  let pnl = null;
  if (version && storeCode) {
    inputs = await listSalesDriverInputs({ versionId, scenario, storeCode });
    pnl = await getScopePL(versionId, { scenario, scope: "COMPANY_STORE", storeCode });
  }

  async function createVersionAction(formData) {
    "use server";
    const s = await getSession();
    if (!hasRole(s, "ADMIN", "FINANCE")) throw new Error("Not permitted");
    const { versionId: newId } = await createPlanVersion({
      label: String(formData.get("label") || "").trim(),
      kind: formData.get("kind") === "FORECAST" ? "FORECAST" : "BUDGET",
      fiscal_year: formData.get("fiscal_year") ? Number(formData.get("fiscal_year")) : null,
    }, s);
    redirect(`/plan/builder?version=${newId}`);
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan · Finance" title="Budget / Forecast Builder"
        right={version ? `${version.kind} · ${version.label}${version.fiscal_year ? ` · FY${version.fiscal_year}` : ""}` : "No plan version yet"} />
      <RelatedRail links={[
        { label: "Plan P&L (preview)", href: "/plan/pl" },
        { label: "Forecast Builder (legacy)", href: "/operate/forecast" },
        { label: "Scenario Planning", href: "/plan/scenarios" },
        { label: "Management Accounts", href: "/finance-os/management-accounts" },
      ]} />
      <BuilderUI
        versions={versions.map((v) => ({ version_id: v.version_id, label: v.label, kind: v.kind, fiscal_year: v.fiscal_year }))}
        scenarios={scenarios.map((s) => ({ scenario_code: s.scenario_code, name: s.name }))}
        stores={stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name }))}
        months={months}
        inputs={inputs.map((r) => ({ period: r.period, method: r.method, footfall: r.footfall, conversion: r.conversion, atv: r.atv, direct_sales: r.direct_sales, adjustment_amount: r.adjustment_amount, adjustment_pct: r.adjustment_pct, trading_days: r.trading_days }))}
        selected={{ versionId, scenario, storeCode }}
        pnl={pnl}
        canManage={canManage}
        createVersionAction={createVersionAction}
      />
    </div>
  );
}
