import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { getReport } from "../../../../../lib/report-store";
import { buildReportTabs } from "../../../../../lib/report-datasets";
import { buildWorkbook } from "../../../../../lib/ma-export";
import { PERIODS } from "../../../../../lib/ma-boardpack-view";
import { audit } from "../../../../../lib/governance";

export const dynamic = "force-dynamic";

// Download a saved report as an Excel workbook — one sheet per tab of its
// dataset, at the report's saved period. Any signed-in user may download; the
// download is audited.
export async function GET(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const report = await getReport(Number(id));
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const p = report.params || {};
  const { ready, reason, tabs } = await buildReportTabs(report.dataset_key, p);
  if (!ready || !tabs.length) {
    return NextResponse.json({ error: reason || "No data to export" }, { status: 400 });
  }
  const period = PERIODS.includes(p.period) ? p.period : "current";
  const buffer = buildWorkbook({ title: `Miniso UK — ${report.name}`, tabs, period });
  if (!buffer) return NextResponse.json({ error: "No data to export" }, { status: 400 });

  await audit({ actor: session, eventType: "report.export", objectType: "report_def", objectRef: String(report.report_id) });

  const slug = String(report.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="miniso-uk-${slug}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
