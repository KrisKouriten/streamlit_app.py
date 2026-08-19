import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { canExport } from "../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../lib/reporting/watermark";
import Restricted from "../../restricted";
import ScreenWatermark from "../../screen-watermark";
import { getThreeStatement } from "../../../lib/threestatement";
import { getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, EntityScopeBanner } from "../ui";
import PerspectivePanel from "../../perspective-panel";
import ThreeStatementUI from "./ts-ui";

export const dynamic = "force-dynamic";

// Three-statement model (Tier 3.2) — the consolidated P&L, Balance Sheet and a
// derived indirect Cash Flow, linked. The P&L and BS are the real Joiin
// consolidation; the cash flow is the balance-sheet movement re-expressed and
// reconciled to the actual change in cash (no invented figures — any residual
// is shown). Balance sheet and cash flow appear once the Joiin BS feed is
// loaded (migration 036 + a refresh); until then the P&L stands alone.
export default async function ThreeStatement({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canExport(session)) return <Restricted title="Three-Statement Model" />;

  const params = await searchParams;
  const [model, scope] = await Promise.all([getThreeStatement(params?.month || null), getConnectedEntities()]);

  return (
    <div className="fos-shell">
      <ScreenWatermark text={confidentialStamp(session, new Date())} />
      <PageHeader crumb="Perform" title="Three-statement model"
        right={model.ym ? `As at ${model.ym} · P&L · Balance Sheet · Cash Flow` : "Awaiting Joiin feed"} />
      <EntityScopeBanner scope={scope} asAt={model.ym || null} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-0.5rem 0 1rem" }}>
        <PerspectivePanel pageId="three-statement" pageName="Three-Statement" filters={{ period: model.ym || undefined }} />
      </div>
      <ThreeStatementUI model={model} />
    </div>
  );
}
