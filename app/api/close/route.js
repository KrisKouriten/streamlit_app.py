import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { getCloseBoard, openCloseRun, lockClose, reopenClose, setStepOverride } from "../../../lib/close";

export const dynamic = "force-dynamic";

/*
 * Close orchestration API. GET returns the evaluated board for a period (or the
 * latest loaded period). POST drives the human dispositions — open a run, sign
 * off / waive / block a step, lock, reopen — all ADMIN/FINANCE only. The
 * automatic gates are evaluated read-only on every GET; nothing here ticks them.
 */

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const period = new URL(request.url).searchParams.get("period") || null;
  try {
    const board = await getCloseBoard(period);
    return NextResponse.json(board);
  } catch (e) {
    console.error("close GET error:", e.message);
    return NextResponse.json({ error: "Could not load the close board" }, { status: 500 });
  }
}

const STEP_STATUSES = new Set(["DONE", "NA", "BLOCKED", "CLEAR"]);

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Managing the close requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const { action, period } = body;
  if (!/^\d{4}-\d{2}$/.test(period || "")) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  const actor = session.email || session.name;

  try {
    if (action === "open") return NextResponse.json({ ok: true, run: await openCloseRun(period, actor) });
    if (action === "lock") return NextResponse.json({ ok: true, run: await lockClose(period, actor, body.note) });
    if (action === "reopen") return NextResponse.json({ ok: true, run: await reopenClose(period, actor, body.note) });
    if (action === "override") {
      if (!body.stepCode) return NextResponse.json({ error: "stepCode is required" }, { status: 400 });
      if (!STEP_STATUSES.has(body.status)) return NextResponse.json({ error: "status must be DONE, NA, BLOCKED or CLEAR" }, { status: 400 });
      await setStepOverride({ period, stepCode: body.stepCode, status: body.status, note: body.note, actor });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("close POST error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
