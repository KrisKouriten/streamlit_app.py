import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { STAGES } from "../../../lib/close-config";
import { listEntities } from "../../../lib/entities";
import Dashboard from "../../dashboard";

export const dynamic = "force-dynamic";

// Month-end close, re-homed under OPERATE and wired to the real active entities.
export default async function MonthEnd() {
  const session = await getSession();
  if (!session) redirect("/login");
  const entities = (await listEntities()).filter((e) => e.is_active).map((e) => e.entity_name);
  return <Dashboard user={session} stages={STAGES} entities={entities} />;
}
