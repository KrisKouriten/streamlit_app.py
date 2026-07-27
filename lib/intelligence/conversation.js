import { query } from "../db";
import { deriveConversationTitle } from "./conversation-rules";

/*
 * Conversation memory for Finance Buddy (migration 039). A conversation is a
 * titled thread of user/assistant turns owned by one signed-in user. Assistant
 * turns link back to the governed intelligence.ai_run that produced them, so
 * sources / claims / confidence / audit all stay in the Phase 1 record — this
 * layer only remembers the dialogue.
 *
 * Ownership is enforced on every read/write by user_email: a user can only see
 * and append to their own conversations. Title derivation is the pure helper in
 * conversation-rules.js.
 */
export { deriveConversationTitle };

// Create a new conversation for a session, titled from the opening question.
export async function createConversation(session, firstQuestion = "") {
  const title = deriveConversationTitle(firstQuestion);
  const { rows } = await query(
    `INSERT INTO intelligence.buddy_conversation (user_id, user_email, title)
     VALUES ($1, $2, $3) RETURNING conversation_id, title, created_at`,
    [session?.id ?? null, session?.email ?? null, title]
  );
  return rows[0];
}

// Fetch a conversation the session owns, or null. Ownership-scoped by email.
export async function getConversation(conversationId, session) {
  const { rows } = await query(
    `SELECT conversation_id, title, message_count, created_at, last_message_at, archived
     FROM intelligence.buddy_conversation
     WHERE conversation_id = $1 AND user_email = $2 AND archived = false`,
    [conversationId, session?.email ?? null]
  );
  return rows[0] || null;
}

// The turns of a conversation, oldest first (for rendering and for model memory).
export async function getMessages(conversationId, session, limit = 100) {
  const owned = await getConversation(conversationId, session);
  if (!owned) return [];
  const { rows } = await query(
    `SELECT message_id, role, content, confidence, question_type, sources, refused, run_id, created_at
     FROM intelligence.buddy_message
     WHERE conversation_id = $1
     ORDER BY created_at ASC, message_id ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

// Prior turns shaped as Anthropic messages, for conversational memory. Only the
// last `turns` messages are carried so the context stays bounded; governed facts
// for the CURRENT question are supplied fresh by the orchestrator, not replayed.
export async function priorTurns(conversationId, session, turns = 8) {
  const msgs = await getMessages(conversationId, session, 200);
  return msgs
    .slice(-turns)
    .map((m) => ({ role: m.role === "ASSISTANT" ? "assistant" : "user", content: m.content }));
}

// List a user's recent conversations for the history panel.
export async function listConversations(session, limit = 30) {
  const { rows } = await query(
    `SELECT conversation_id, title, message_count, last_message_at
     FROM intelligence.buddy_conversation
     WHERE user_email = $1 AND archived = false
     ORDER BY last_message_at DESC
     LIMIT $2`,
    [session?.email ?? null, limit]
  );
  return rows;
}

// Append a turn and bump the conversation's rolling metadata in one go.
export async function addMessage(conversationId, { role, content, runId = null, confidence = null, questionType = null, sources = null, refused = false }) {
  const { rows } = await query(
    `INSERT INTO intelligence.buddy_message
       (conversation_id, role, content, run_id, confidence, question_type, sources, refused)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING message_id, created_at`,
    [conversationId, role, String(content || ""), runId, confidence, questionType,
     sources ? JSON.stringify(sources) : null, !!refused]
  );
  await query(
    `UPDATE intelligence.buddy_conversation
       SET message_count = message_count + 1, last_message_at = CURRENT_TIMESTAMP
     WHERE conversation_id = $1`,
    [conversationId]
  );
  return rows[0];
}

// Archive (soft-delete) a conversation the session owns.
export async function archiveConversation(conversationId, session) {
  const { rowCount } = await query(
    `UPDATE intelligence.buddy_conversation SET archived = true
     WHERE conversation_id = $1 AND user_email = $2`,
    [conversationId, session?.email ?? null]
  );
  return rowCount > 0;
}
