import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../../lib/auth";
import { PageHeader } from "../../../finance-os/ui";
import CapexWorkspace from "../capex-ui";
import { loadCapexData } from "../shared";

export const dynamic = "force-dynamic";

// Capital Allocation (PLAN — Finance) — the portfolio capital position: capital
// available, committed, remaining and funding required against the hurdle rate.
// Its own route (rather than a ?view= flag on /plan/capex) so the sidebar item
// highlights correctly and the page is a real, linkable destination. Shares the
// exact data load and workspace with Capex Investment; only the pinned view and
// the page title differ.
export default async function CapitalAllocation({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const canView = hasRole(session, "ADMIN", "FINANCE", "EXEC");
  if (!canView) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Plan — Finance" title="Capital Allocation" />
        <div className="fos-card" style={{ padding: "26px 24px", textAlign: "center", borderColor: "color-mix(in srgb, var(--red) 35%, var(--line))" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>You don&rsquo;t have access to Capital Allocation</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            This workspace is limited to Finance, Exec and Admin. Ask an administrator if you need investment appraisal and capital allocation.
          </div>
        </div>
      </div>
    );
  }

  const data = await loadCapexData(searchParams, "allocation");
  const canManage = hasRole(session, "ADMIN", "FINANCE", "EXEC");

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — Finance" title="Capital Allocation"
        right="Capital available, committed & funding required across the portfolio, against the hurdle rate" />
      <CapexWorkspace {...data} canManage={canManage} />
    </div>
  );
}
