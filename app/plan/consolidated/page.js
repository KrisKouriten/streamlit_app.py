import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listPlanVersions, listScenarios, getConsolidatedPL, listConsolidationAdjustments } from "../../../lib/planning";
import { PageHeader, RelatedRail } from "../../finance-os/ui";
import ConsolidatedUI from "./consolidated-ui";

export const dynamic = "force-dynamic";

/*
 * Consolidated P&L — Σ approved company-store + head-office + franchise-store plan
 * lines + approved consolidation adjustments, rendered through the governed
 * `consolidated` template. Five columns (Company Stores / Head Office / Franchise /
 * Adjustments / Consolidated); the Consolidated column reconciles to the sum of the
 * others by construction. Read-only P&L + an adjustments register (draft → approved).
 */
export default async function ConsolidatedPnl({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const sp = (await searchParams) || {};
  const versions = await listPlanVersions();
  const scenarios = await listScenarios();
  const versionId = sp.version ? Number(sp.version) : (versions[0]?.version_id ?? null);
  const version = versions.find((v) => Number(v.version_id) === versionId) || null;
  const scenario = typeof sp.scenario === "string" && sp.scenario ? sp.scenario : (version?.base_scenario || "BASE");

  let pnl = null;
  let adjustments = [];
  if (version) {
    pnl = await getConsolidatedPL(versionId, { scenario });
    adjustments = await listConsolidationAdjustments({ versionId, scenario });
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Plan · Finance" title="Consolidated P&L"
        right={version ? `${version.kind} · ${version.label}${version.fiscal_year ? ` · FY${version.fiscal_year}` : ""}` : "No plan version yet"} />
      <RelatedRail links={[
        { label: "Budget / Forecast Builder", href: "/plan/builder" },
        { label: "Plan P&L (preview)", href: "/plan/pl" },
        { label: "Management Accounts", href: "/finance-os/management-accounts" },
      ]} />
      <ConsolidatedUI
        versions={versions.map((v) => ({ version_id: v.version_id, label: v.label, kind: v.kind, fiscal_year: v.fiscal_year }))}
        scenarios={scenarios.map((s) => ({ scenario_code: s.scenario_code, name: s.name }))}
        selected={{ versionId, scenario }}
        pnl={pnl}
        adjustments={adjustments.map((a) => ({ adj_id: a.adj_id, kind: a.kind, nominal: a.nominal, period: a.period, amount: a.amount, reason: a.reason, status: a.status }))}
        canManage={canManage}
      />
    </div>
  );
}
