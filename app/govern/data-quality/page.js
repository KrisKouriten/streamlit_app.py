import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { getDiagnostics } from "../../../lib/diagnostics";
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

  const { checks, status } = await getDiagnostics();
  const bad = checks.filter((c) => c.status !== "OK").length;

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
      <DataQualityUI checks={checks} status={status} />
    </div>
  );
}
