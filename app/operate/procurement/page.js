import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getProcurement } from "../../../lib/procurement";
import { getFxRates } from "../../../lib/fx";
import { listOtbVersions } from "../../../lib/otb";
import { listMerchRequests } from "../../../lib/otb-procurement";
import { OTB_CHANNELS, CHANNEL_LABEL } from "../../../lib/otb-rules";
import { PageHeader } from "../../finance-os/ui";
import PerspectivePanel from "../../perspective-panel";
import ProcurementUI from "./procurement-ui";

export const dynamic = "force-dynamic";

// Procurement Request — raise Miniso purchases, local purchases, and OTB-linked
// merchandising requests. The cash-tracker sections keep the monthly cash budget
// control (supplier payment terms decide the cash-out month); the merchandising
// request form (moved here from the OTB workspace) raises a channel request
// validated against the approved Open-to-Buy before it becomes a commitment.
export default async function Procurement({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE", "OPS");
  const roles = { canManage, isHod: hasRole(session, "ADMIN", "EXEC"), isFinance: hasRole(session, "ADMIN", "FINANCE"), isAdmin: hasRole(session, "ADMIN") };
  const sp = (await searchParams) || {};
  const [pr, otbVersions, fxRates] = await Promise.all([
    getProcurement(),
    listOtbVersions().catch(() => []),
    getFxRates().catch(() => []),
  ]);
  // The approved / draft OTB versions a request can be raised against, newest first.
  const versions = (otbVersions || []).filter((v) => v.status !== "ARCHIVED");
  const activeVersion = (sp.v && versions.find((v) => String(v.otb_version_id) === String(sp.v))) || versions[0] || null;
  const merchRequests = activeVersion
    ? await listMerchRequests({ otbVersionId: activeVersion.otb_version_id }).catch(() => [])
    : [];
  const channelOpts = OTB_CHANNELS.map((c) => [c, CHANNEL_LABEL[c] || c]);

  return (
    <div className="fos-shell">
      <PageHeader crumb="Operate" title="Procurement Requests"
        right={pr.loaded ? "Cash budget vs committed spend" : "Awaiting purchases"} />
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-1rem 0 1rem" }}>
        <PerspectivePanel pageId="procurement" pageName="Procurement" />
      </div>
      <ProcurementUI data={pr.summary} ready={pr.ready} loaded={pr.loaded} illustrative={pr.illustrative} canManage={canManage}
        orders={pr.orders || []} roles={roles} fxRates={fxRates || []}
        otbVersions={versions} activeVersionId={activeVersion?.otb_version_id || null} merchRequests={merchRequests} channelOpts={channelOpts} />
    </div>
  );
}
