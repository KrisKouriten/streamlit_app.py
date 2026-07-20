import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import {
  createAction, transitionAction, addActionUpdate, addActionEvidence, recordRealised,
  validateBenefit, getAction, ACTION_TRANSITIONS, actionTransitionError, SOURCE_TYPES,
} from "../../../lib/actions";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const isManager = hasRole(session, "ADMIN", "FINANCE");
  const canClose = hasRole(session, "ADMIN", "FINANCE", "EXEC");

  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "create") {
      if (!body.title?.trim() || !body.ownerName?.trim()) {
        return NextResponse.json({ error: "An action needs a title and an owner" }, { status: 400 });
      }
      if (body.sourceType && !SOURCE_TYPES.includes(body.sourceType)) {
        return NextResponse.json({ error: "Invalid source" }, { status: 400 });
      }
      const actionId = await createAction({
        title: body.title.trim(), description: body.description?.trim(), ownerName: body.ownerName.trim(),
        sponsor: body.sponsor?.trim(), dueDate: body.dueDate || null, sourceType: body.sourceType || "MANUAL",
        sourceRef: body.sourceRef?.trim(), rootCause: body.rootCause?.trim(),
        expectedValue: body.expectedValue != null && body.expectedValue !== "" ? Number(body.expectedValue) : null,
        dashboardCode: body.dashboardCode || null,
      }, session);
      return NextResponse.json({ ok: true, actionId });
    }

    if (ACTION_TRANSITIONS[body.action]) {
      const current = await getAction(Number(body.actionId));
      if (!current) return NextResponse.json({ error: "Action not found" }, { status: 404 });
      const isOwner = (current.owner_name || "").toLowerCase() === (session.name || "").toLowerCase();
      const err = actionTransitionError(body.action, current.status, { isOwner, isManager, canClose });
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      // Closure approval should be a distinct check by someone other than the sole owner where possible.
      const to = await transitionAction(Number(body.actionId), body.action, session, { note: body.note?.trim() });
      return NextResponse.json({ ok: true, status: to });
    }

    if (body.action === "update") {
      const pct = body.progressPct != null ? Number(body.progressPct) : null;
      if (pct != null && (pct < 0 || pct > 100)) return NextResponse.json({ error: "Progress must be 0–100" }, { status: 400 });
      if (!body.body?.trim() && pct == null) return NextResponse.json({ error: "Add a note or a progress value" }, { status: 400 });
      await addActionUpdate(Number(body.actionId), session, { body: body.body?.trim(), progressPct: pct });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "evidence") {
      if (!body.label?.trim()) return NextResponse.json({ error: "Evidence needs a label" }, { status: 400 });
      await addActionEvidence(Number(body.actionId), session, { label: body.label.trim(), url: body.url?.trim(), note: body.note?.trim() });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "record-realised") {
      const v = Number(body.value);
      if (!Number.isFinite(v)) return NextResponse.json({ error: "Realised value must be a number" }, { status: 400 });
      await recordRealised(Number(body.actionId), v, body.note?.trim(), session);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "validate-benefit") {
      if (!canClose) return NextResponse.json({ error: "Benefit validation requires ADMIN, FINANCE or EXEC" }, { status: 403 });
      const v = Number(body.value);
      if (!Number.isFinite(v)) return NextResponse.json({ error: "Validated value must be a number" }, { status: 400 });
      if (!["VALIDATED", "DISPUTED"].includes(body.decision)) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
      await validateBenefit(Number(body.opportunityId), v, body.decision, body.comment?.trim(), session);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("actions API error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
