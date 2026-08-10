import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { supplierExposure, getFacilityLimits, facilityPosition, listSuppliers } from "../../../lib/suppliers";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import SuppliersUI from "./suppliers-ui";

export const dynamic = "force-dynamic";

/*
 * Suppliers & Credit (OPERATE) — Finance's view of supplier order commitments
 * against each supplier's credit limit, plus the HSBC trade-facility position.
 * Reads the exposure report (procurement + P.O commitment + facility outstanding
 * matched on normalised name), the facility limits and the HSBC headroom, and
 * lets Finance maintain supplier credit limits and the facility ceiling.
 */
export default async function SuppliersAndCredit() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = hasRole(session, "ADMIN", "FINANCE");

  if (!canManage) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <PageHeader crumb="Operate" title="Suppliers & Credit" />
        <EmptyState title="Finance only">
          This desk is limited to Finance and Admin.
        </EmptyState>
      </div>
    );
  }

  const exposure = await supplierExposure().catch(() => ({ ready: false, rows: [], totals: null }));

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Operate" title="Suppliers & Credit"
        right="Supplier orders vs credit limits & the HSBC facility position" />

      {!exposure.ready ? (
        <EmptyState title="One migration to run">
          Suppliers & Credit needs the supplier master (migration <span style={{ fontFamily: "var(--mono)" }}>090_supplier_master.sql</span>). Apply it, refresh, and supplier exposure will appear here.
        </EmptyState>
      ) : (
        <SuppliersUI
          exposure={exposure}
          facilityLimits={await getFacilityLimits().catch(() => [])}
          hsbc={await facilityPosition("HSBC").catch(() => null)}
          suppliers={(await listSuppliers().catch(() => ({ suppliers: [] }))).suppliers}
        />
      )}
    </div>
  );
}
