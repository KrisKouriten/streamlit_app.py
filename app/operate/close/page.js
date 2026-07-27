import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getCloseBoard } from "../../../lib/close";
import { getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, EntityScopeBanner } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";
import CloseCockpitUI from "./close-ui";

export const dynamic = "force-dynamic";

// Close Cockpit (Tier 3.1) — the orchestration layer over month-end close. Each
// period's close is a tracked run whose machine-checkable gates (actuals loaded,
// feeds fresh, pre-close exceptions cleared, workstream playbook, tasks done,
// commentary drafted) go green on their own; only the genuinely-human sign-offs
// wait on a person. The pre-close exception detail still lives on Management
// accounts close; this screen is the readiness view and the lock control.
export default async function CloseCockpit({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const params = await searchParams;
  const [board, scope] = await Promise.all([getCloseBoard(params?.period || null), getConnectedEntities()]);

  return (
    <div className="fos-shell">
      <PageHeader crumb="Operate" title="Close Cockpit"
        right={board.period ? `Period ${board.period} · readiness & lock` : "Awaiting actuals"} />
      <EntityScopeBanner scope={scope} asAt={board.period ? `${board.period} close` : null} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-0.5rem 0 1rem" }}>
        <PerspectivePanel pageId="month-end-close" pageName="Month-end Close" filters={{ period: board.period || undefined }} />
      </div>
      <CloseCockpitUI board={board} canManage={canManage} />
    </div>
  );
}
