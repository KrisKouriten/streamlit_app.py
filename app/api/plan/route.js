import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { ingestDataset, ingestWorkbook, DATASETS } from "../../../lib/plan";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Uploading the plan requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "upload") {
      if (!DATASETS.includes(body.dataset)) return NextResponse.json({ error: "Unknown dataset" }, { status: 400 });
      if (!body.csv?.trim()) return NextResponse.json({ error: "No CSV content" }, { status: 400 });
      const r = await ingestDataset(body.dataset, body.csv, session);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "workbook") {
      if (!body.b64) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      const buffer = Buffer.from(body.b64, "base64");
      const summary = await ingestWorkbook(buffer, session);
      if (Object.values(summary).every((v) => v == null)) {
        return NextResponse.json({ error: "No recognised sheets found in that workbook" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, summary });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("plan API error:", e.message);
    return NextResponse.json({ error: e.message || "Upload failed" }, { status: 400 });
  }
}
