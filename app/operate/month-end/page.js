import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { STAGES } from "../../../lib/close-config";
import { listEntities } from "../../../lib/entities";
import { listUsersWithRoles } from "../../../lib/governance";
import CloseJourney from "../close-journey";
import Dashboard from "../../dashboard";

export const dynamic = "force-dynamic";

// Month-end close: every entity's close tasks with finance owner + status,
// summarised at the top (overall completion, entities closed / in progress).
// Step 1 of the close journey — its completion feeds the Close Cockpit gate.
export default async function MonthEnd() {
  const session = await getSession();
  if (!session) redirect("/login");
  const entities = (await listEntities()).filter((e) => e.is_active).map((e) => e.entity_name);
  const team = (await listUsersWithRoles()).map((u) => u.name).filter(Boolean).sort();
  return (
    <>
      <div className="fos-shell-narrow" style={{ paddingBottom: 0 }}><CloseJourney active="month-end" /></div>
      <Dashboard user={session} stages={STAGES} entities={entities} team={team} />
    </>
  );
}
