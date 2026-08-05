import { query } from "./db";

/*
 * My Actions & Notes — private to one user. Every function takes the numeric
 * user id (from the session, never from the client) and filters every read and
 * write by it, so a user can only ever see or change their own rows — even a
 * guessed note/todo id belonging to someone else won't match. Degrades to empty
 * before migration 080.
 */

const tableMissing = (e) => e?.code === "42P01";
const MAX = 4000; // keep a single note / todo sane

function clean(body) {
  const s = String(body ?? "").trim();
  return s ? s.slice(0, MAX) : null;
}

export async function getMyActions(userId) {
  if (!userId) return { ready: true, notes: [], todos: [] };
  try {
    const [{ rows: notes }, { rows: todos }] = await Promise.all([
      query(`SELECT note_id, body, created_at, updated_at FROM personal.note WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]),
      query(`SELECT todo_id, body, done, done_at, created_at FROM personal.todo WHERE user_id = $1 ORDER BY done ASC, created_at DESC`, [userId]),
    ]);
    return { ready: true, notes, todos };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, notes: [], todos: [] };
    throw e;
  }
}

// ---- notes ----
export async function addNote(userId, body) {
  const b = clean(body);
  if (!b) throw new Error("Note is empty");
  const { rows } = await query(`INSERT INTO personal.note (user_id, body) VALUES ($1, $2) RETURNING note_id, body, created_at, updated_at`, [userId, b]);
  return rows[0];
}

export async function updateNote(userId, noteId, body) {
  const b = clean(body);
  if (!b) throw new Error("Note is empty");
  const { rows } = await query(
    `UPDATE personal.note SET body = $3, updated_at = CURRENT_TIMESTAMP WHERE note_id = $2 AND user_id = $1 RETURNING note_id, body, created_at, updated_at`,
    [userId, noteId, b]
  );
  if (!rows.length) throw new Error("Note not found");
  return rows[0];
}

export async function deleteNote(userId, noteId) {
  const { rowCount } = await query(`DELETE FROM personal.note WHERE note_id = $2 AND user_id = $1`, [userId, noteId]);
  return { deleted: rowCount };
}

// ---- todos ----
export async function addTodo(userId, body) {
  const b = clean(body);
  if (!b) throw new Error("To-do is empty");
  const { rows } = await query(`INSERT INTO personal.todo (user_id, body) VALUES ($1, $2) RETURNING todo_id, body, done, done_at, created_at`, [userId, b]);
  return rows[0];
}

export async function setTodoDone(userId, todoId, done) {
  const { rows } = await query(
    `UPDATE personal.todo SET done = $3, done_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE todo_id = $2 AND user_id = $1 RETURNING todo_id, body, done, done_at, created_at`,
    [userId, todoId, !!done]
  );
  if (!rows.length) throw new Error("To-do not found");
  return rows[0];
}

export async function deleteTodo(userId, todoId) {
  const { rowCount } = await query(`DELETE FROM personal.todo WHERE todo_id = $2 AND user_id = $1`, [userId, todoId]);
  return { deleted: rowCount };
}

export async function clearDoneTodos(userId) {
  const { rowCount } = await query(`DELETE FROM personal.todo WHERE user_id = $1 AND done`, [userId]);
  return { deleted: rowCount };
}
