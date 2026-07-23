import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getPreclose, getCloseActions } from "../../../lib/preclose";
import { getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, EntityScopeBanner } from "../../finance-os/ui";
import ManagementCloseUI from "./mc-ui";

export const dynamic = "force-dynamic";

// Management accounts close — the month-end reconciliation playbook. Pre-close
// checks run the real Xero actuals against the reference model (completeness /
// variable drift / fixed drift / sign), exceptions carry a confirm · correct ·
// explain review, and the close actions track the assurance steps per period.
// Execution ticks per entity stay on WORKFLOW → Month-end close.
export default async function ManagementClose({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const params = await searchParams;
  const monthsCovered = Math.max(1, Math.min(12, Number(params?.months) || 6));

  const [pre, scope] = await Promise.all([getPreclose({ monthsCovered }), getConnectedEntities()]);
  const actions = pre.period ? await getCloseActions(pre.period) : [];

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Operate" title="Management accounts close"
        right={pre.period ? `Period ${pre.period} · checks before sign-off` : "Awaiting Xero actuals"} />
      <EntityScopeBanner scope={scope} asAt={pre.dk ? `${String(pre.dk).slice(0, 4)}-${String(pre.dk).slice(4, 6)}-${String(pre.dk).slice(6, 8)}` : null} />
      <ManagementCloseUI pre={pre} actions={actions} canManage={canManage} monthsCovered={monthsCovered} />
    </div>
  );
}
