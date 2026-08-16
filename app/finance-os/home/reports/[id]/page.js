import { redirect } from "next/navigation";
import { getSession, hasRole, isAdmin } from "../../../../../lib/auth";
import { scopeForSession } from "../../../../../lib/intelligence/permission";
import { resolveReport, validateReportById, listVersions } from "../../../../../lib/reporting/reports";
import { confidentialStamp } from "../../../../../lib/reporting/watermark";
import ScreenWatermark from "../../../../screen-watermark";
import { PageHeader, EmptyState } from "../../../ui";
import Builder from "./builder";

export const dynamic = "force-dynamic";

export default async function ReportBuilderPage({ params }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasRole(session, "ADMIN", "FINANCE", "EXEC")) {
    return <div style={{ padding: "1rem 0" }}><PageHeader crumb="Report" title="Report" /><EmptyState title="Access required">Finance or executive access is needed to view reports.</EmptyState></div>;
  }
  const { id } = await params;
  const scope = scopeForSession(session);
  const resolved = await resolveReport(id, scope);
  if (!resolved) {
    return <div style={{ padding: "1rem 0" }}><PageHeader crumb="Report" title="Report not found" /><EmptyState title="Not found">This report does not exist or the reporting schema is not migrated (run migration 045).</EmptyState></div>;
  }
  const validation = await validateReportById(id, scope);
  const versions = await listVersions(id);
  const canEdit = hasRole(session, "ADMIN", "FINANCE");
  const canApprove = isAdmin(session);

  return (
    <div style={{ padding: "1rem 0" }}>
      <ScreenWatermark text={confidentialStamp(session, new Date())} />
      <PageHeader crumb="Corporate Reporting Centre · Builder" title={resolved.report.title} right={resolved.report.version_label} />
      <Builder
        reportId={String(id)}
        initial={{ report: resolved.report, sections: resolved.sections, allSections: resolved.allSections, components: resolved.components, validation, versions }}
        canEdit={canEdit}
        canApprove={canApprove}
      />
    </div>
  );
}
