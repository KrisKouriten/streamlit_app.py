import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/auth";
import { audit } from "../../../lib/governance";

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const period = new URL(request.url).searchParams.get("period");
  if (!period) return NextResponse.json({ error: "Missing period" }, { status: 400 });

  const { rows } = await query(
    "SELECT task_key, done, done_by, done_at FROM task_state WHERE period = $1 AND done = true",
    [period]
  );
  const state = {};
  for (const r of rows) {
    state[r.task_key] = { done: true, by: r.done_by, at: r.done_at };
  }
  return NextResponse.json({ state });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const { period, taskKey, done } = await request.json();
    if (!period || !taskKey || typeof done !== "boolean") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (done) {
      await query(
        `INSERT INTO task_state (period, task_key, done, done_by, done_at)
         VALUES ($1, $2, true, $3, now())
         ON CONFLICT (period, task_key)
         DO UPDATE SET done = true, done_by = $3, done_at = now()`,
        [period, taskKey, session.name || session.email]
      );
    } else {
      await query(
        `INSERT INTO task_state (period, task_key, done, done_by, done_at)
         VALUES ($1, $2, false, NULL, NULL)
         ON CONFLICT (period, task_key)
         DO UPDATE SET done = false, done_by = NULL, done_at = NULL`,
        [period, taskKey]
      );
    }
    await audit({ actor: session, eventType: "task.toggle", objectType: "task_state",
      objectRef: `${period}|${taskKey}`, detail: { done } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
