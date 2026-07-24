import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { listForUser, unreadCountFor, markRead, markAllRead } from "../../../lib/notifications";

export const dynamic = "force-dynamic";

// The signed-in user's own notifications only — never another user's.
export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get("count") != null) {
    return NextResponse.json({ count: await unreadCountFor(session.id) });
  }
  return NextResponse.json({ notifications: await listForUser(session.id) });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.action === "markAllRead") {
    const n = await markAllRead(session.id);
    return NextResponse.json({ ok: true, marked: n });
  }
  if (body.action === "markRead" && body.notificationId != null) {
    await markRead(body.notificationId, session.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
