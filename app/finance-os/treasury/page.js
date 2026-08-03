import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getTreasuryOverview } from "../../../lib/treasury";
import { PageHeader, EmptyState } from "../ui";
import TreasuryUI from "./treasury-ui";

export const dynamic = "force-dynamic";

/*
 * Treasury (PERFORM). The funding + cash desk: the HSBC bank trade facility
 * (TradePay + post-shipment buyer loans), the bank term loan register, FX hedging,
 * the sales income streams (retail / wholesale / franchise) and store cash
 * reconciliations. The trade facility is a seeded read-only register; the rest are
 * managed here by Finance.
 */
export default async function TreasuryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const data = await getTreasuryOverview();

  const anyReady = data.facility.ready || data.loans.ready || data.sales.ready;
  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Perform" title="Treasury" right="Facilities, funding, hedging & cash" />
      {!anyReady ? (
        <EmptyState title="One migration to run">
          Treasury needs migration <span style={{ fontFamily: "var(--mono)" }}>077_treasury.sql</span> (schema + the seeded HSBC trade facility). Apply it and refresh.
        </EmptyState>
      ) : (
        <TreasuryUI data={data} canManage={canManage} />
      )}
    </div>
  );
}
