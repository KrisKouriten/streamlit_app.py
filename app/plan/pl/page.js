import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listPlanVersions, listScenarios, listPlanStores, getScopePL, createPlanVersion } from "../../../lib/planning";
import { PageHeader, RelatedRail } from "../../finance-os/ui";
import PlanPnlUI from "./pl-ui";

export const dynamic = "force-dynamic";

// The scopes a user can view a P&L for. CONSOLIDATION_ADJUSTMENT is an input
// scope, not a view — the consolidated roll-up is a later phase.
const VIEW_SCOPES = [
  { scope: "COMPANY_STORE", label: "Company stores" },
  { scope: "HEAD_OFFICE", label: "Head office" },
  { scope: "FRANCHISE_STORE", label: "Franchise stores" },
];

/*
 * Plan P&L (preview) — the first screen over the driver-based planning engine.
 * Read-only: it renders a chosen plan version × scenario × scope through the
 * SAME governed P&L template the actuals board packs use (getScopePL →
 * renderFormat), so a plan and an actual of the same scope look identical.
 * Driver/cost/payroll entry is the next phase; this proves the engine → template
 * seam and puts the already-built engine on screen.
 */
export default async function PlanPnlPreview({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const versions = await listPlanVersions();
  const scenarios = await listScenarios();

  // Resolve the selection, defaulting to the newest version and a sensible scope.
  const versionId = sp.version ? Number(sp.version) : (versions[0]?.version_id ?? null);
  const version = versions.find((v) => Number(v.version_id) === versionId) || null;
  const scope = VIEW_SCOPES.some((s) => s.scope === sp.scope) ? sp.scope : "COMPANY_STORE";
  const scenario = typeof sp.scenario === "string" && sp.scenario ? sp.scenario : (version?.base_scenario || "BASE");
  const stores = await listPlanStores({ scope });
  const storeCode = stores.some((s) => s.store_code === sp.store) ? sp.store : null;

  let pnl = null;
  if (version) {
    pnl = await getScopePL(versionId, { scenario, scope, storeCode });
  }

  async function createVersionAction(formData) {
    "use server";
    const s = await getSession();
    if (!hasRole(s, "ADMIN", "FINANCE")) throw new Error("Not permitted");
    const { versionId: newId } = await createPlanVersion({
      label: String(formData.get("label") || "").trim(),
      kind: formData.get("kind") === "BUDGET" ? "BUDGET" : "FORECAST",
      fiscal_year: formData.get("fiscal_year") ? Number(formData.get("fiscal_year")) : null,
    }, s);
    redirect(`/plan/pl?version=${newId}`);
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan · Finance" title="Plan P&L (preview)"
        right={version ? `${version.kind} · ${version.label}` : "No plan version yet"} />
      <RelatedRail links={[
        { label: "Forecast Builder", href: "/operate/forecast" },
        { label: "Scenario Planning", href: "/plan/scenarios" },
        { label: "Budget & Forecast", href: "/finance-os/budget-forecast" },
        { label: "Management Accounts", href: "/finance-os/management-accounts" },
      ]} />
      <PlanPnlUI
        versions={versions.map((v) => ({ version_id: v.version_id, label: v.label, kind: v.kind, fiscal_year: v.fiscal_year, base_scenario: v.base_scenario }))}
        scenarios={scenarios.map((s) => ({ scenario_code: s.scenario_code, name: s.name }))}
        stores={stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name }))}
        viewScopes={VIEW_SCOPES}
        selected={{ versionId, scenario, scope, storeCode }}
        pnl={pnl}
        canManage={canManage}
        createVersionAction={createVersionAction}
      />
    </div>
  );
}
