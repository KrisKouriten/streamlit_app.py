import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { STAGES } from "../../../lib/close-config";
import { listEntities } from "../../../lib/entities";
import { listUsersWithRoles } from "../../../lib/governance";
import Dashboard from "../../dashboard";

export const dynamic = "force-dynamic";

// Month-end close: every entity's close tasks with finance owner + status,
// summarised at the top (overall completion, entities closed / in progress).
export default async function MonthEnd() {
  const session = await getSession();
  if (!session) redirect("/login");
  const entities = (await listEntities()).filter((e) => e.is_active).map((e) => e.entity_name);
  const team = (await listUsersWithRoles()).map((u) => u.name).filter(Boolean).sort();
  return <Dashboard user={session} stages={STAGES} entities={entities} team={team} />;
}
