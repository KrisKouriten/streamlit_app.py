import { query } from "./db";

/*
 * My Actions & Notes — private to one user. Every function takes the numeric
 * user id (from the session, never from the client) and filters every read and
 * write by it, so a user can only ever see or change their own rows — even a
 * guessed note/todo id belonging to someone else won't match. Degrades to empty
 * before migration 080.
 */

const tableMissing = (e) => e?.code === "42P01";
const columnMissing = (e) => e?.code === "42703";
const MAX = 4000; // keep a single note / todo sane

// A YYYY-MM-DD string or null (empty / invalid clears the deadline).
function cleanDate(v) {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
// to_char keeps a date column as a clean YYYY-MM-DD string (no timezone shift).
const TODO_COLS = `todo_id, body, done, done_at, created_at, to_char(due_date,'YYYY-MM-DD') AS due_date`;

function clean(body) {
  const s = String(body ?? "").trim();
  return s ? s.slice(0, MAX) : null;
}

export async function getMyActions(userId) {
  if (!userId) return { ready: true, notes: [], todos: [] };
  const notesP = query(`SELECT note_id, body, created_at, updated_at FROM personal.note WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
  // Open tasks first, then by soonest deadline (undated last), then newest.
  const todosSql = (cols, order) => `SELECT ${cols} FROM personal.todo WHERE user_id = $1 ORDER BY ${order}`;
  const todosP = query(todosSql(TODO_COLS, `done ASC, (due_date IS NULL), due_date ASC, created_at DESC`), [userId])
    .catch((e) => {
      if (columnMissing(e)) return query(todosSql(`todo_id, body, done, done_at, created_at, NULL AS due_date`, `done ASC, created_at DESC`), [userId]);
      throw e;
    });
  try {
    const [{ rows: notes }, { rows: todos }] = await Promise.all([notesP, todosP]);
    return { ready: true, notes, todos };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, notes: [], todos: [] };
    throw e;
  }
}

// Headline counts for the Home hero band — open tasks and how many are overdue.
export async function getMyActionsSummary(userId) {
  if (!userId) return { open: 0, overdue: 0 };
  try {
    const { rows } = await query(
      `SELECT count(*) FILTER (WHERE NOT done)::int AS open,
              count(*) FILTER (WHERE NOT done AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int AS overdue
       FROM personal.todo WHERE user_id = $1`,
      [userId]
    );
    return { open: rows[0].open, overdue: rows[0].overdue };
  } catch (e) {
    if (tableMissing(e)) return { open: 0, overdue: 0 };
    if (columnMissing(e)) { const { rows } = await query(`SELECT count(*) FILTER (WHERE NOT done)::int AS open FROM personal.todo WHERE user_id = $1`, [userId]); return { open: rows[0].open, overdue: 0 }; }
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
export async function addTodo(userId, body, due) {
  const b = clean(body);
  if (!b) throw new Error("To-do is empty");
  const d = cleanDate(due);
  try {
    const { rows } = await query(`INSERT INTO personal.todo (user_id, body, due_date) VALUES ($1, $2, $3) RETURNING ${TODO_COLS}`, [userId, b, d]);
    return rows[0];
  } catch (e) {
    if (columnMissing(e)) { const { rows } = await query(`INSERT INTO personal.todo (user_id, body) VALUES ($1, $2) RETURNING todo_id, body, done, done_at, created_at, NULL AS due_date`, [userId, b]); return rows[0]; }
    throw e;
  }
}

export async function setTodoDone(userId, todoId, done) {
  const cols = TODO_COLS;
  try {
    const { rows } = await query(
      `UPDATE personal.todo SET done = $3, done_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE todo_id = $2 AND user_id = $1 RETURNING ${cols}`,
      [userId, todoId, !!done]
    );
    if (!rows.length) throw new Error("To-do not found");
    return rows[0];
  } catch (e) {
    if (columnMissing(e)) {
      const { rows } = await query(`UPDATE personal.todo SET done = $3, done_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE todo_id = $2 AND user_id = $1 RETURNING todo_id, body, done, done_at, created_at, NULL AS due_date`, [userId, todoId, !!done]);
      if (!rows.length) throw new Error("To-do not found");
      return rows[0];
    }
    throw e;
  }
}

// Set or clear a task's deadline (due null/empty clears it).
export async function setTodoDue(userId, todoId, due) {
  try {
    const { rows } = await query(`UPDATE personal.todo SET due_date = $3 WHERE todo_id = $2 AND user_id = $1 RETURNING ${TODO_COLS}`, [userId, todoId, cleanDate(due)]);
    if (!rows.length) throw new Error("To-do not found");
    return rows[0];
  } catch (e) {
    if (columnMissing(e)) throw new Error("Run migration 081_todo_due_date.sql to set deadlines.");
    throw e;
  }
}

export async function deleteTodo(userId, todoId) {
  const { rowCount } = await query(`DELETE FROM personal.todo WHERE todo_id = $2 AND user_id = $1`, [userId, todoId]);
  return { deleted: rowCount };
}

export async function clearDoneTodos(userId) {
  const { rowCount } = await query(`DELETE FROM personal.todo WHERE user_id = $1 AND done`, [userId]);
  return { deleted: rowCount };
}
