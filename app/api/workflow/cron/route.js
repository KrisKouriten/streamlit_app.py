import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { runAutoWorkflow } from "../../../../lib/auto-workflow";
import { resolveBaseUrl } from "../../../../lib/invite-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * The daily automatic follow-ups on the Finance desks (lib/auto-workflow.js):
 * challenged P.Os and procurement requests not resubmitted within 5 working
 * days are cancelled, and invoices Finance have chased once are chased again
 * every 5 working days until they arrive.
 *
 * Vercel Cron issues GET with the CRON_SECRET bearer on weekday mornings; the
 * run itself skips nothing on a bank holiday, it simply finds nothing new due.
 * An ADMIN/FINANCE session can POST to run it now, or POST { dryRun: true } to
 * see what it would do without changing anything.
 */

function baseUrlOf(request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin") || (host ? `${request.headers.get("x-forwarded-proto") || "https"}://${host}` : null);
  return resolveBaseUrl({ origin, env: process.env });
}

const cronOk = (request) => {
  const auth = request.headers.get("authorization") || "";
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
};

export async function GET(request) {
  if (!cronOk(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Cron has no browser origin, so links come from the configured public URL.
  return NextResponse.json(await runAutoWorkflow({ baseUrl: resolveBaseUrl({ origin: null, env: process.env }) }));
}

export async function POST(request) {
  if (cronOk(request)) return NextResponse.json(await runAutoWorkflow({ baseUrl: resolveBaseUrl({ origin: null, env: process.env }) }));
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Running the automatic follow-ups requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await runAutoWorkflow({ baseUrl: baseUrlOf(request), dryRun: body?.dryRun === true }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
