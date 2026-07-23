import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listEntities } from "../../../lib/entities";
import { PageHeader } from "../../finance-os/ui";
import EntitiesAdmin from "./entities-admin";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const entities = await listEntities();
  const active = entities.filter((e) => e.is_active).length;
  const connected = entities.filter((e) => e.xero_status === "CONNECTED").length;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <PageHeader crumb="Govern · Entities" title="Entities"
        right={`${active} active · ${connected} connected to Xero`} />
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, maxWidth: "70ch", lineHeight: 1.55 }}>
        The legal entities Miniso UK consolidates. The display name is what appears across the app; the legal name is
        used for statutory and Xero mapping. Entities with a live Xero feed are marked — those figures flow into the
        consolidated finance dashboards. {canManage ? "Add or amend entities below." : "Managing entities requires ADMIN or FINANCE."}
      </p>
      <EntitiesAdmin entities={entities} canManage={canManage} />
    </div>
  );
}
