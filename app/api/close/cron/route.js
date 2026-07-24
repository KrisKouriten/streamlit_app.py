import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { runAgent } from "../../../../lib/agents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Scheduled close-readiness run. Vercel Cron issues GET with the CRON_SECRET
 * bearer; a manual kick is allowed for an ADMIN/FINANCE session. Runs the
 * CLOSE_STATUS agent, which reports readiness for the latest loaded period and
 * lands its status on the close dashboard. Read-only — it never locks a period.
 */

async function run(actor) {
  const result = await runAgent("CLOSE_STATUS", actor, "SCHEDULED");
  return NextResponse.json(result);
}

const CRON_ACTOR = { email: "close-cron", name: "close-cron", roles: [] };

export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(CRON_ACTOR);
}

export async function POST(request) {
  const auth = request.headers.get("authorization") || "";
  const cronOk = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (cronOk) return run(CRON_ACTOR);
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Running the close agent requires ADMIN or FINANCE" }, { status: 403 });
  }
  return run(session);
}
