import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { addNote, updateNote, deleteNote, addTodo, setTodoDone, deleteTodo, clearDoneTodos, getMyActions } from "../../../lib/personal";

/*
 * My Actions & Notes — private per-user. Every handler resolves the user from
 * the session (session.id) and passes it to the data layer, which scopes every
 * query by it. The client never supplies a user id, so one user can't read or
 * change another's notes / to-dos.
 */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const data = await getMyActions(session.id);
  return NextResponse.json(data);
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const uid = session.id;
  const body = await request.json().catch(() => ({}));
  const { action } = body;
  try {
    switch (action) {
      case "addNote": return NextResponse.json({ ok: true, note: await addNote(uid, body.body) });
      case "updateNote": return NextResponse.json({ ok: true, note: await updateNote(uid, body.id, body.body) });
      case "deleteNote": return NextResponse.json({ ok: true, ...(await deleteNote(uid, body.id)) });
      case "addTodo": return NextResponse.json({ ok: true, todo: await addTodo(uid, body.body) });
      case "setTodoDone": return NextResponse.json({ ok: true, todo: await setTodoDone(uid, body.id, body.done) });
      case "deleteTodo": return NextResponse.json({ ok: true, ...(await deleteTodo(uid, body.id)) });
      case "clearDone": return NextResponse.json({ ok: true, ...(await clearDoneTodos(uid)) });
      default: return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
