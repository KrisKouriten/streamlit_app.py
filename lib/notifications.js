import { query } from "./db";

/*
 * Notification store — DB layer. Producers call notifyUser / notifyUserByName;
 * the inbox and bell call listForUser / unreadCountFor; the user marks read.
 * Every write is best-effort and swallows "table missing" (42P01) so a producer
 * never fails just because migration 034 hasn't been run yet in an environment.
 */

const tableMissing = (e) => e?.code === "42P01";

export async function notifyUser({ userId, kind, title, body = null, link = null, actor = null, objectType = null, objectRef = null }) {
  if (!userId || !kind || !title) return;
  try {
    await query(
      `INSERT INTO governance.notification (user_id, kind, title, body, link, actor, object_type, object_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, kind, title, body, link, actor, objectType, objectRef]
    );
  } catch (e) {
    if (!tableMissing(e)) throw e; // pre-migration: skip silently
  }
}

// Notify by the user's display name (used where a producer only knows a name,
// e.g. an agent's configured reviewer). No match → no-op, never an error.
export async function notifyUserByName(name, payload) {
  if (!name) return;
  try {
    const { rows } = await query(`SELECT id FROM users WHERE name = $1 AND is_active <> false LIMIT 1`, [name]);
    if (rows[0]) await notifyUser({ userId: rows[0].id, ...payload });
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }
}

export async function listForUser(userId, limit = 50) {
  try {
    const { rows } = await query(
      `SELECT notification_id, kind, title, body, link, actor, object_type, object_ref, read_at, created_at
       FROM governance.notification WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

export async function unreadCountFor(userId) {
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM governance.notification WHERE user_id = $1 AND read_at IS NULL`, [userId]);
    return rows[0].n;
  } catch (e) {
    if (tableMissing(e)) return 0;
    throw e;
  }
}

export async function markRead(notificationId, userId) {
  await query(`UPDATE governance.notification SET read_at = CURRENT_TIMESTAMP WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL`, [notificationId, userId]);
}

export async function markAllRead(userId) {
  const { rowCount } = await query(`UPDATE governance.notification SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return rowCount;
}
