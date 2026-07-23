import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listVersions } from "../../../lib/forecast-versions";
import { PageHeader } from "../../finance-os/ui";
import VersionsUI from "./versions-ui";

export const dynamic = "force-dynamic";

// Finance Data · Forecast & Budget Versions — snapshot the working forecast into
// named, lockable budget/forecast versions and compare them line for line.
export default async function VersionsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = (await searchParams) || {};
  const kind = sp.kind === "BUDGET" || sp.kind === "FORECAST" ? sp.kind : null;

  const { ready, versions } = await listVersions();
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader
        crumb="Finance Data"
        title="Forecast & Budget Versions"
        right={ready ? `${versions.length} version${versions.length === 1 ? "" : "s"}` : "Awaiting migration"}
      />
      {!ready ? (
        <div style={{ fontSize: 13.5, color: "var(--faint)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "16px 18px" }}>
          Run migration <span style={{ fontFamily: "var(--mono)" }}>028</span> to enable forecast &amp; budget versions.
        </div>
      ) : (
        <VersionsUI versions={versions} initialKind={kind} canManage={canManage} />
      )}
    </div>
  );
}
