import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listSkuPrices, pricingDashboard } from "../../../lib/pricing";
import { PageHeader } from "../../finance-os/ui";
import PricingWorkspace from "./pricing-ui";

export const dynamic = "force-dynamic";

// Pricing Review (PLAN — HO) — the SKU cost-build → margin → health workspace.
// Finance/Ops/Admin load the priced range, see the KPI dashboard, upload a cost
// build, add or edit SKUs, drill into the per-SKU build/margin/health and run a
// what-if. All pricing maths lives in lib/pricing-rules; this screen only reads
// the decorated rows and posts to /api/pricing.
export default async function PricingReview({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const canView = hasRole(session, "ADMIN", "FINANCE", "OPS");
  if (!canView) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Plan — HO" title="Pricing Review" />
        <div className="fos-card" style={{ padding: "26px 24px", textAlign: "center", borderColor: "color-mix(in srgb, var(--red) 35%, var(--line))" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>You don&rsquo;t have access to Pricing Review</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            This workspace is limited to Finance, Ops and Admin. Ask an administrator if you need the cost build and margin analysis.
          </div>
        </div>
      </div>
    );
  }

  const sp = (await searchParams) || {};
  const channel = sp.channel || null;
  const category = sp.category || null;
  const status = sp.status || null;
  const q = sp.q || null;

  const [skus, dashboard] = await Promise.all([
    listSkuPrices({ channel, category, status, search: q }).catch(() => []),
    pricingDashboard({ channel }).catch(() => ({ ready: false })),
  ]);

  // Category list for the filter — unique, sorted, from the loaded range.
  const categories = Array.from(new Set(skus.map((s) => s.category).filter(Boolean))).sort();

  const canManage = hasRole(session, "ADMIN", "FINANCE", "OPS");

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — HO" title="Pricing Review"
        right="Cost build, margin analysis and pricing health across the range" />
      <PricingWorkspace
        skus={skus}
        dashboard={dashboard}
        categories={categories}
        filters={{ channel: channel || "", category: category || "", status: status || "", q: q || "" }}
        canManage={canManage}
      />
    </div>
  );
}
