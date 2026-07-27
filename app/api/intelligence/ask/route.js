import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { audit } from "../../../../lib/governance";
import { runBuddy } from "../../../../lib/intelligence/orchestrator";
import { recordFeedback } from "../../../../lib/intelligence/runs";
import {
  createConversation, getConversation, getMessages, listConversations,
  priorTurns, addMessage, archiveConversation,
} from "../../../../lib/intelligence/conversation";

export const dynamic = "force-dynamic";
// Finance Buddy makes one Claude call inside runBuddy — allow beyond the default
// so a slower Opus completion does not time out (matches the agents endpoint).
export const maxDuration = 60;

// Finance Buddy is a finance tool: gate on the same grants that get an
// unrestricted scope today (matches the rest of the app — no row-level security).
function canUseBuddy(session) {
  return hasRole(session, "ADMIN", "FINANCE", "EXEC");
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUseBuddy(session)) {
    return NextResponse.json({ error: "Finance Buddy requires a finance role." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body.action || "ask";

  try {
    if (action === "ask") {
      const question = String(body.question || "").trim();
      if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
      if (question.length > 2000) return NextResponse.json({ error: "That question is too long — please shorten it." }, { status: 400 });

      // Continue an owned conversation, or start a new one titled from the question.
      let conversation = null;
      if (body.conversationId) {
        conversation = await getConversation(body.conversationId, session);
        if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      } else {
        conversation = await createConversation(session, question);
      }

      // Prior turns (before this question) become the model's memory.
      const history = await priorTurns(conversation.conversation_id, session, 8);
      await addMessage(conversation.conversation_id, { role: "USER", content: question });

      const result = await runBuddy({ session, question, history, conversationId: conversation.conversation_id });

      if (!result.ok) {
        // Record the failed turn so the thread stays honest about what happened.
        await addMessage(conversation.conversation_id, {
          role: "ASSISTANT", content: result.error || "Sorry — I couldn't answer that.",
          runId: result.runId, refused: false,
        });
        return NextResponse.json({ error: result.error || "Could not answer.", conversationId: conversation.conversation_id, runId: result.runId }, { status: 502 });
      }

      const answer = result.refusal
        ? "I can't answer that one — it falls outside what I'm allowed to do (I interpret governed finance data; I can't take actions or go beyond it)."
        : result.answer;

      const saved = await addMessage(conversation.conversation_id, {
        role: "ASSISTANT", content: answer, runId: result.runId,
        confidence: result.confidence?.level || null, questionType: result.questionType,
        sources: result.sources, refused: !!result.refusal,
      });

      return NextResponse.json({
        conversationId: conversation.conversation_id,
        title: conversation.title,
        messageId: saved.message_id,
        answer,
        refused: !!result.refusal,
        confidence: result.confidence || null,
        questionType: result.questionType,
        sources: result.sources || [],
        warnings: result.warnings || [],
        runId: result.runId,
      });
    }

    if (action === "history") {
      const conversations = await listConversations(session, 30);
      return NextResponse.json({ conversations });
    }

    if (action === "conversation") {
      const conversation = await getConversation(body.conversationId, session);
      if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      const messages = await getMessages(conversation.conversation_id, session, 200);
      return NextResponse.json({ conversation, messages });
    }

    if (action === "archive") {
      const ok = await archiveConversation(body.conversationId, session);
      if (ok) await audit({ actor: session, eventType: "intelligence.buddy.archive", objectType: "buddy_conversation", objectRef: String(body.conversationId) });
      return NextResponse.json({ ok });
    }

    if (action === "feedback") {
      if (!body.runId || !body.rating) return NextResponse.json({ error: "Feedback needs a runId and rating." }, { status: 400 });
      const fb = await recordFeedback({ runId: body.runId, rating: body.rating, reason: body.reason || null, comment: body.comment || null, session });
      return NextResponse.json({ ok: true, feedbackId: fb?.feedback_id ?? null });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("intelligence/ask error:", e.message);
    return NextResponse.json({ error: "Could not complete the request." }, { status: 500 });
  }
}
