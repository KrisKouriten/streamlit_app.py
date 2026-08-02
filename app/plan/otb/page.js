import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import {
  listOtbVersions, listChannels, getOtbVersion, getOtbSummary, reconcileVersion,
  getStoreSales, getAssumptions, getInventoryPositions, listNewStores, listClosures,
  listClearance, listMinStockRules, listCommitments, listTransfers,
} from "../../../lib/otb";
import { listMerchRequests } from "../../../lib/otb-procurement";
import OtbWorkspace from "./otb-ui";

export const dynamic = "force-dynamic";

// Merchandising Open-to-Buy (OTB) workspace (PLAN). A version-controlled OTB plan
// computed separately for the two purchase channels (Miniso MDS / Local Purchase):
// sales plan → assumptions → inventory & registers → computed Remaining OTB, then
// a procurement request flow validated against the approved OTB pool. Finance/Ops
// build and Finance/Admin approve, lock and reopen versions.
export default async function OtbPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!hasRole(session, "ADMIN", "FINANCE", "OPS")) {
    return (
      <div className="fos-shell" style={{ padding: "1rem 0" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "26px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>No access to Open-to-Buy</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            The Merchandising OTB workspace is available to Finance, Merchandising Ops and admins. Ask an admin if you need access.
          </div>
        </div>
      </div>
    );
  }

  const sp = (await searchParams) || {};
  const [versions, channels] = await Promise.all([
    listOtbVersions().catch(() => []),
    listChannels().catch(() => []),
  ]);

  const selectedId = sp.v || (versions[0] && versions[0].otb_version_id) || null;
  const version = selectedId ? await getOtbVersion(selectedId).catch(() => null) : null;

  let detail = null;
  let requests = [];
  if (version) {
    const scenario = version.scenario_code || "BASE";
    const [summary, reconciliation, storeSales, assumptions, inventory, newStores, closures, clearance, minStock, commitments, transfers] = await Promise.all([
      getOtbSummary(version.otb_version_id, { scenario }).catch(() => ({ byChannel: {}, total: {}, computed: false })),
      reconcileVersion(version.otb_version_id, { scenario }).catch(() => ({ ready: false, stores: [] })),
      getStoreSales(version.otb_version_id, { scenario }).catch(() => []),
      getAssumptions(version.otb_version_id).catch(() => []),
      getInventoryPositions(version.otb_version_id).catch(() => []),
      listNewStores(version.otb_version_id).catch(() => []),
      listClosures(version.otb_version_id).catch(() => []),
      listClearance(version.otb_version_id).catch(() => []),
      listMinStockRules().catch(() => []),
      listCommitments(version.otb_version_id).catch(() => []),
      listTransfers(version.otb_version_id).catch(() => []),
    ]);
    detail = { summary, reconciliation, storeSales, assumptions, inventory, newStores, closures, clearance, minStock, commitments, transfers };
    requests = await listMerchRequests({ otbVersionId: version.otb_version_id }).catch(() => []);
  }

  const isAdmin = hasRole(session, "ADMIN");
  const isFinance = hasRole(session, "FINANCE");
  const canApprove = isAdmin || isFinance;

  return (
    <div className="fos-shell" style={{ padding: "1rem 0" }}>
      <OtbWorkspace
        versions={versions}
        channels={channels}
        version={version}
        detail={detail}
        requests={requests}
        roles={session.roles}
        isAdmin={isAdmin}
        isFinance={isFinance}
        canApprove={canApprove}
      />
    </div>
  );
}
