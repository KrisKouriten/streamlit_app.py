import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { exportForecastXlsx } from "../../../../lib/forecast";

export const dynamic = "force-dynamic";

// Download the forecast as an Excel workbook — consolidated group, company-store
// total, one sheet per store, plus head office & franchise. Any signed-in user
// may download (viewing, not mutating).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const buffer = await exportForecastXlsx();
  if (!buffer) return NextResponse.json({ error: "No forecast loaded to export" }, { status: 400 });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="miniso-uk-store-forecast.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
