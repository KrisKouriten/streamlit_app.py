import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../../lib/auth";
import { generateBriefing } from "../../../../../lib/intelligence/briefing";

export const dynamic = "force-dynamic";
// One governed Claude call inside generateBriefing — allow beyond the default.
export const maxDuration = 60;

/*
 * Scheduled proactive finance briefing. Vercel Cron issues GET with the
 * CRON_SECRET bearer; an ADMIN/FINANCE session may kick one manually via POST.
 * The system actor carries a finance grant so the briefing sees exactly what the
 * app shows finance users today (the shared permission posture). Read-only — it
 * generates and notifies, and takes no action.
 */

// System actor for scheduled runs: finance visibility, no user id.
const CRON_ACTOR = { email: "briefing-cron", name: "Finance Intelligence", roles: ["ADMIN"] };

async function run(actor) {
  const result = await generateBriefing({ actor });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(CRON_ACTOR);
}

export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return run(CRON_ACTOR);
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Generating a briefing requires ADMIN or FINANCE" }, { status: 403 });
  }
  return run(session);
}
