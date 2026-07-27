import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import { audit } from "../../../../lib/governance";
import { runPerspective, suggestedQuestions } from "../../../../lib/intelligence/orchestrator";
import { recordFeedback } from "../../../../lib/intelligence/runs";
import { createAction } from "../../../../lib/actions";
import { isPerspectivePage } from "../../../../lib/intelligence/perspective-pages";

export const dynamic = "force-dynamic";
// AI Perspective makes one governed Claude call inside runPerspective — allow
// beyond the default so a slower completion does not time out.
export const maxDuration = 60;

// Same finance grants that get an unrestricted scope today (matches the app).
function canUse(session) {
  return hasRole(session, "ADMIN", "FINANCE", "EXEC");
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canUse(session)) return NextResponse.json({ error: "AI Perspective requires a finance role." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = body.action || "perspective";

  try {
    if (action === "perspective") {
      const pageId = String(body.pageId || "").trim();
      if (!pageId) return NextResponse.json({ error: "A pageId is required." }, { status: 400 });
      if (!isPerspectivePage(pageId)) return NextResponse.json({ error: "AI Perspective is not enabled for this page." }, { status: 400 });
      const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
      const question = typeof body.question === "string" ? body.question.slice(0, 2000) : "";

      const result = await runPerspective({ session, pageId, filters, question });
      if (!result.ok && result.error) {
        return NextResponse.json({ error: result.error, runId: result.runId }, { status: 502 });
      }
      // Refusal is a valid, honestly-surfaced outcome (not an error).
      return NextResponse.json({
        ok: result.ok,
        refusal: !!result.refusal,
        perspective: result.perspective || null,
        sources: result.sources || [],
        confidence: result.confidence || null,
        claimsVerified: result.claimsVerified ?? null,
        warnings: result.warnings || [],
        runId: result.runId,
      });
    }

    if (action === "suggestions") {
      const questions = await suggestedQuestions(String(body.pageId || ""));
      return NextResponse.json({ questions });
    }

    if (action === "create-action") {
      const title = String(body.title || "").trim();
      if (!title) return NextResponse.json({ error: "An action needs a title." }, { status: 400 });
      const expected = body.expectedValue != null && body.expectedValue !== "" ? Number(body.expectedValue) : null;
      const actionId = await createAction({
        title: title.slice(0, 250),
        description: body.description ? String(body.description) : null,
        ownerName: body.ownerName?.trim() || session.name,
        sourceType: "AI_PERSPECTIVE",
        sourceRef: `perspective:${body.pageId || "page"}${body.runId ? ` run:${body.runId}` : ""}`,
        expectedValue: Number.isFinite(expected) ? Math.abs(expected) : null,
      }, session);
      await audit({ actor: session, eventType: "intelligence.perspective.create-action", objectType: "action_register", objectRef: String(actionId), detail: { runId: body.runId || null, pageId: body.pageId || null } });
      return NextResponse.json({ ok: true, actionId });
    }

    if (action === "feedback") {
      if (!body.runId || !body.rating) return NextResponse.json({ error: "Feedback needs a runId and rating." }, { status: 400 });
      const fb = await recordFeedback({ runId: body.runId, rating: body.rating, reason: body.reason || null, comment: body.comment || null, session });
      return NextResponse.json({ ok: true, feedbackId: fb?.feedback_id ?? null });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("intelligence/perspective error:", e.message);
    return NextResponse.json({ error: "Could not complete the request." }, { status: 500 });
  }
}
