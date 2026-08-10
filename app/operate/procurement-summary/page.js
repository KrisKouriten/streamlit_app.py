import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listForClose } from "../../../lib/procurement-close";
import { facilityRefPairs } from "../../../lib/treasury";
import { getFxRates } from "../../../lib/fx";
import { findRate } from "../../../lib/fx-rules";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import ProcurementSummaryUI from "./procurement-summary-ui";

export const dynamic = "force-dynamic";

/*
 * Procurement Summary + Close (OPERATE) — Finance's review desk for procurement
 * purchases. Mirrors P.O Summary + Close: every cash-tracker purchase (Miniso /
 * Local) and OTB-linked merch request lands here. Finance approves, may challenge
 * under a controlled reason, records the invoice number + net and payment status,
 * then CLOSES it (→ committed spend). Downloadable to CSV, all or the filtered set.
 */
export default async function ProcurementSummaryClose() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = hasRole(session, "ADMIN", "FINANCE");

  if (!canManage) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Operate" title="Procurement Summary + Close" />
        <EmptyState title="Finance only">
          This desk is limited to Finance and Admin.
        </EmptyState>
      </div>
    );
  }

  const res = await listForClose({ limit: 500 }).catch(() => ({ ready: false, rows: [] }));
  // The COSTING USD→GBP rate (from the Exchange Rates tab) values foreign stock.
  const fxRates = await getFxRates().catch(() => []);
  const costingRate = findRate(fxRates, "USD", "COSTING");
  // Facility ref → customer ref pairs, so the LC customer reference auto-fills
  // from the LC reference once the HSBC extract carries it.
  const facilityRefs = await facilityRefPairs().catch(() => []);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Operate" title="Procurement Summary + Close"
        right="Approve, challenge, invoice and close procurement purchases" />

      {!res.ready ? (
        <EmptyState title="One migration to run">
          This screen needs the procurement finance-close columns (migration <span style={{ fontFamily: "var(--mono)" }}>073_procurement_finance_close.sql</span>). Apply it, refresh, and procurement purchases will appear here.
        </EmptyState>
      ) : (
        <ProcurementSummaryUI initialRows={res.rows} costingRate={costingRate} facilityRefs={facilityRefs} />
      )}
    </div>
  );
}
