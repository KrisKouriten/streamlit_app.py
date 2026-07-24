import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../lib/auth";
import { listReports } from "../../lib/report-store";
import { DATASETS, buildReportTabs, datasetLabel } from "../../lib/report-datasets";
import { applyPeriod } from "../../lib/ma-export-rules";
import { PageHeader } from "../finance-os/ui";
import ReportsUI from "./reports-ui";

export const dynamic = "force-dynamic";

// Report Builder (Tier 3.3) — save a report as a dataset + parameters and
// re-run / export it without an engineer building each one. Reuses the layout
// grammar and the Excel/PDF export path already in the platform; the datasets
// are the real Joiin P&L, balance sheet and board packs.
export default async function Reports({ searchParams }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");

  const params = await searchParams;
  const reports = await listReports();

  let preview = null;
  if (params?.id) {
    const rep = reports.find((r) => String(r.report_id) === String(params.id));
    if (rep) {
      const p = rep.params || {};
      const period = p.period || "current";
      const { ready, reason, tabs } = await buildReportTabs(rep.dataset_key, p);
      preview = {
        id: rep.report_id, name: rep.name, dataset: datasetLabel(rep.dataset_key), ready, reason,
        tabs: (tabs || []).map((t) => ({ label: t.label, view: applyPeriod(t.data, period) })),
      };
    }
  }

  return (
    <div className="fos-shell">
      <PageHeader crumb="Govern" title="Report Builder" right="Saved reports · export to Excel & PDF" />
      <ReportsUI reports={reports} datasets={DATASETS} canManage={canManage} preview={preview} />
    </div>
  );
}
