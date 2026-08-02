import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listScenarios, getScenario } from "../../../lib/pricing-scenario";
import { listSkuPrices } from "../../../lib/pricing";
import { PageHeader } from "../../finance-os/ui";
import PricingScenarioWorkspace from "./pricing-scenario-ui";

export const dynamic = "force-dynamic";

// Pricing Scenario (PLAN — HO) — model a promotion / markdown / permanent price
// change across a set of SKUs and see its blended-margin and company-margin
// impact before committing. Scenarios never touch the live pricing master; they
// snapshot current price + cost + baseline sales and hold proposed new prices.
// All maths lives in lib/pricing-scenario-rules; this screen reads the decorated
// lines + dashboard and posts to /api/pricing-scenario.
export default async function PricingScenario({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const canView = hasRole(session, "ADMIN", "FINANCE", "OPS");
  if (!canView) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Plan — HO" title="Pricing Scenario" />
        <div className="fos-card" style={{ padding: "26px 24px", textAlign: "center", borderColor: "color-mix(in srgb, var(--red) 35%, var(--line))" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>You don&rsquo;t have access to Pricing Scenario</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            This workspace is limited to Finance, Ops and Admin. Ask an administrator if you need to model price changes and their margin impact.
          </div>
        </div>
      </div>
    );
  }

  const sp = (await searchParams) || {};
  const selectedId = sp.s || null;

  const scenarios = await listScenarios().catch(() => []);
  const selected = selectedId ? await getScenario(selectedId).catch(() => null) : null;
  const skuOptions = (await listSkuPrices({ limit: 2000 }).catch(() => [])).map((x) => ({
    sku_code: x.sku_code, channel_code: x.channel_code, description: x.description, category: x.category,
  }));

  const canApprove = hasRole(session, "ADMIN", "FINANCE");

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — HO" title="Pricing Scenario"
        right="Model a promotion or price change and see its blended-margin impact" />
      <PricingScenarioWorkspace
        scenarios={scenarios}
        selected={selected}
        skuOptions={skuOptions}
        canApprove={canApprove}
      />
    </div>
  );
}
