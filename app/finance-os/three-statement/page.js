import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { getThreeStatement } from "../../../lib/threestatement";
import { getConnectedEntities } from "../../../lib/finance-os";
import { PageHeader, EntityScopeBanner } from "../ui";
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

  const params = await searchParams;
  const [model, scope] = await Promise.all([getThreeStatement(params?.month || null), getConnectedEntities()]);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Perform" title="Three-statement model"
        right={model.ym ? `As at ${model.ym} · P&L · Balance Sheet · Cash Flow` : "Awaiting Joiin feed"} />
      <EntityScopeBanner scope={scope} asAt={model.ym || null} />
      <ThreeStatementUI model={model} />
    </div>
  );
}
