import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { PageHeader } from "../../finance-os/ui";
import CapexWorkspace from "./capex-ui";
import { loadCapexData } from "./shared";

export const dynamic = "force-dynamic";

// Capex Investment (PLAN — Finance) — investment appraisal, the 10-year model and
// capital allocation across the portfolio. Finance/Exec/Admin load the projects,
// the portfolio consolidation and the capital position, drill into a project's
// multi-year model, and set the annual allocation. All appraisal maths lives in
// lib/capex-rules; this screen only reads the decorated rows and posts to
// /api/capex and /api/capex/<project_id>.
export default async function CapexInvestment({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const canView = hasRole(session, "ADMIN", "FINANCE", "EXEC");
  if (!canView) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Plan — Finance" title="Capex Investment" />
        <div className="fos-card" style={{ padding: "26px 24px", textAlign: "center", borderColor: "color-mix(in srgb, var(--red) 35%, var(--line))" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>You don&rsquo;t have access to Capex Investment</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            This workspace is limited to Finance, Exec and Admin. Ask an administrator if you need investment appraisal and capital allocation.
          </div>
        </div>
      </div>
    );
  }

  const data = await loadCapexData(searchParams);
  const canManage = hasRole(session, "ADMIN", "FINANCE", "EXEC");

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan — Finance" title="Capex Investment"
        right="Investment appraisal, the 10-year model and capital allocation across the portfolio" />
      <CapexWorkspace {...data} canManage={canManage} />
    </div>
  );
}
