import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getPreclose, getCloseActions } from "../../../lib/preclose";
import { getConnectedEntities } from "../../../lib/finance-os";
import { getAccrualReview } from "../../../lib/management-accounts";
import { DEFAULT_MATERIALITY } from "../../../lib/accrual-rules";
import { PageHeader, EntityScopeBanner } from "../../finance-os/ui";
import CloseJourney from "../close-journey";
import ManagementCloseUI from "./mc-ui";
import AccrualReviewUI from "./accrual-ui";

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
  const accrualMonth = params?.accrualMonth || null;
  const materiality = Math.max(0, Number(params?.materiality) || DEFAULT_MATERIALITY);

  const [pre, scope, accrual] = await Promise.all([
    getPreclose({ monthsCovered }),
    getConnectedEntities(),
    getAccrualReview({ targetMonth: accrualMonth, materiality }),
  ]);
  const actions = pre.period ? await getCloseActions(pre.period) : [];

  return (
    <div className="fos-shell">
      <PageHeader crumb="Operate" title="Management accounts close"
        right={pre.period ? `Period ${pre.period} · checks before sign-off` : "Awaiting Xero actuals"} />
      <CloseJourney active="management" />
      <EntityScopeBanner scope={scope} asAt={pre.dk ? `${String(pre.dk).slice(0, 4)}-${String(pre.dk).slice(4, 6)}-${String(pre.dk).slice(6, 8)}` : null} />
      <ManagementCloseUI pre={pre} actions={actions} canManage={canManage} monthsCovered={monthsCovered} />
      <AccrualReviewUI review={accrual} targetMonth={accrual?.target || accrualMonth} materiality={materiality} />
    </div>
  );
}
