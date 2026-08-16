import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { buildManagementAccountsWorkbook } from "../../../../lib/ma-export";
import { PERIODS } from "../../../../lib/ma-boardpack-view";
import { audit } from "../../../../lib/governance";
import { canExport } from "../../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../../lib/reporting/watermark";

export const dynamic = "force-dynamic";

// Download the Management Accounts board pack as an Excel workbook — one sheet
// per loaded scope (Store / Head Office / Franchise / Consolidated) for the
// chosen year and period. Restricted to the reporting-protection group
// (Finance / Exec / Head / Admin); the download is audited.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canExport(session)) return NextResponse.json({ error: "Downloading packs is restricted to Finance, Exec and department heads." }, { status: 403 });

  const url = new URL(request.url);
  const year = url.searchParams.get("year") || null;
  const period = PERIODS.includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "current";

  const buffer = await buildManagementAccountsWorkbook({ year, period, watermark: confidentialStamp(session, new Date()) });
  if (!buffer) {
    return NextResponse.json({ error: "No Management Accounts actuals loaded to export" }, { status: 400 });
  }

  await audit({ actor: session, eventType: "management_accounts.export", objectType: "joiin_boardpack", objectRef: `${year || "latest"}/${period}` });

  const filename = `miniso-uk-management-accounts-${year || "latest"}-${period}.xlsx`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
