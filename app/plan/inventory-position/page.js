import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listInventoryPositions, getInventorySummary } from "../../../lib/inventory-position";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import InventoryPositionUI from "./inventory-position-ui";

export const dynamic = "force-dynamic";

/*
 * Inventory Position (PLAN · HO) — the live inventory master. Stock in transit
 * (Miniso only), stock in the DC, and stock across all stores, with an inventory
 * summary that drives the consolidated topline into the OTB calculation. Replaces
 * the old per-OTB-version inventory ingest: the OTB process takes inventory over.
 */
export default async function InventoryPositionPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = hasRole(session, "ADMIN", "FINANCE", "OPS");
  const [positions, summary] = await Promise.all([
    listInventoryPositions().catch(() => []),
    getInventorySummary().catch(() => ({ ready: false, channels: [], grand: {} })),
  ]);

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <PageHeader crumb="Plan · HO" title="Inventory Position"
        right="Live stock — in transit, DC & stores — feeding OTB" />
      {!summary.ready ? (
        <EmptyState title="One migration to run">
          This screen needs the inventory-position master (migration <span style={{ fontFamily: "var(--mono)" }}>075_inventory_position.sql</span>). Apply it, refresh, and the inventory position will appear here.
        </EmptyState>
      ) : (
        <InventoryPositionUI positions={positions} summary={summary} canManage={canManage} />
      )}
    </div>
  );
}
