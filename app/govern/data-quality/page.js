import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getDiagnostics, applyRepairs } from "../../../lib/diagnostics";
import { revalidatePath } from "next/cache";
import { PageHeader, EmptyState } from "../../finance-os/ui";
import DataQualityUI from "./data-quality-ui";

export const dynamic = "force-dynamic";

/*
 * Data Quality (GOVERN) — whether each governed feed is actually landing.
 *
 * The platform reads optional data best-effort, so a missing table, an upload
 * that never succeeded and a value the app doesn't recognise all degrade to the
 * same empty column rather than an error. That keeps a missing feed from taking
 * a page down, but it makes those states indistinguishable on screen. This page
 * names them, with the remedy against each.
 */
export default async function DataQualityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return (
      <div className="fos-shell">
        <PageHeader crumb="Govern" title="Data Quality" />
        <EmptyState title="Finance only">This check is limited to Finance and Admin.</EmptyState>
      </div>
    );
  }

  const { checks, status, repairs } = await getDiagnostics();
  const bad = checks.filter((c) => c.status !== "OK").length;

  /*
   * Apply the missing columns to the database THIS APP is connected to.
   *
   * The reason this exists at all: a SQL editor can be, and repeatedly was,
   * pointed at a different Neon branch from the one the app reads, and both
   * sides reported success. Running it here removes the question — the pool
   * that applies the column is the pool that reads it.
   *
   * Admin and Finance only, checked here rather than trusting the page render:
   * a server action is a public endpoint, and the role gate above only decides
   * what gets drawn.
   */
  async function applyRepairsAction(formData) {
    "use server";
    const s = await getSession();
    if (!hasRole(s, "ADMIN", "FINANCE")) throw new Error("Not permitted");
    await applyRepairs(formData.getAll("key").map(String));
    revalidatePath("/govern/data-quality");
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Govern" title="Data Quality"
        right={bad ? `${bad} of ${checks.length} need attention` : `All ${checks.length} checks passing`} />
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, maxWidth: "76ch", lineHeight: 1.55 }}>
        Whether each governed feed is actually landing. The platform reads optional data best-effort — a missing
        table, an upload that never succeeded and a value the app doesn&rsquo;t recognise all show up as an empty
        column rather than an error. That stops one missing feed taking a page down, but it means those very
        different problems look identical. This page tells them apart, and says what to do about each.
      </p>
      <DataQualityUI checks={checks} status={status} repairs={repairs} applyAction={applyRepairsAction} />
    </div>
  );
}
