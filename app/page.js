import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { STAGES, ENTITIES } from "../lib/close-config";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Dashboard user={session} stages={STAGES} entities={ENTITIES} />;
}
