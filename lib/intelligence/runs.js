import { query } from "../db";
import { audit } from "../governance";

/*
 * Permanent, auditable records of every interactive AI run (CR §21.16). A run is
 * opened when a request starts and finished when it resolves; its sources and
 * claims are persisted so every material figure is traceable. Writes here are
 * best-effort — a logging failure must never break the user's request — but the
 * governance.audit_event write goes through the shared audit() helper.
 */

export async function openRun({ surface, session, pageId = null, questionType = null, question = null, filters = null, model = null, promptCode = null, scopeNote = null, conversationId = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO intelligence.ai_run
         (surface, user_id, user_email, page_id, question_type, question, filters, model, prompt_code, scope_note, conversation_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RUNNING')
       RETURNING run_id`,
      [surface, session?.id ?? null, session?.email ?? null, pageId, questionType,
       question ? String(question).slice(0, 2000) : null,
       filters ? JSON.stringify(filters) : null, model, promptCode, scopeNote, conversationId]
    );
    return rows[0]?.run_id ?? null;
  } catch (e) {
    console.error("AI RUN OPEN FAILED", e.message);
    return null;
  }
}

export async function recordStep(runId, stepNo, title, detail = null, status = "SUCCESS") {
  if (!runId) return;
  try {
    await query(
      `INSERT INTO intelligence.ai_run_step (run_id, step_no, title, detail, status) VALUES ($1,$2,$3,$4,$5)`,
      [runId, stepNo, title, detail ? String(detail).slice(0, 500) : null, status]
    );
  } catch (e) {
    console.error("AI RUN STEP FAILED", e.message);
  }
}

export async function recordSources(runId, sources = []) {
  if (!runId || !sources.length) return;
  for (const s of sources) {
    try {
      await query(
        `INSERT INTO intelligence.ai_source
           (run_id, label, module, service, period, entity, store, scenario, data_through, route)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [runId, s.label, s.module ?? null, s.service ?? null, s.period ?? null, s.entity ?? null,
         s.store ?? null, s.scenario ?? null, s.dataThrough ?? null, s.route ?? null]
      );
    } catch (e) {
      console.error("AI SOURCE WRITE FAILED", e.message);
    }
  }
}

export async function recordClaims(runId, claims = []) {
  if (!runId || !claims.length) return;
  for (const c of claims) {
    try {
      await query(
        `INSERT INTO intelligence.ai_claim (run_id, statement, value_text, source_label, verified)
         VALUES ($1,$2,$3,$4,$5)`,
        [runId, String(c.statement || "").slice(0, 1000), c.valueText ?? null, c.sourceLabel ?? null, !!c.verified]
      );
    } catch (e) {
      console.error("AI CLAIM WRITE FAILED", e.message);
    }
  }
}

export async function finishRun(runId, { status, confidence = null, summary = null, usage = null, error = null }, actor = null) {
  if (!runId) return;
  try {
    await query(
      `UPDATE intelligence.ai_run
         SET status = $2, confidence = $3, summary = $4, usage = $5, error = $6, finished_at = CURRENT_TIMESTAMP
       WHERE run_id = $1`,
      [runId, status, confidence, summary ? String(summary).slice(0, 2000) : null,
       usage ? JSON.stringify(usage) : null, error ? String(error).slice(0, 500) : null]
    );
  } catch (e) {
    console.error("AI RUN FINISH FAILED", e.message);
  }
  if (actor) {
    await audit({ actor, eventType: `intelligence.run.${String(status || "done").toLowerCase()}`, objectType: "ai_run", objectRef: String(runId), detail: { confidence } });
  }
}

export async function recordFeedback({ runId, rating, reason = null, comment = null, session = null }) {
  const { rows } = await query(
    `INSERT INTO intelligence.ai_feedback (run_id, rating, reason, comment, user_email)
     VALUES ($1,$2,$3,$4,$5) RETURNING feedback_id`,
    [runId, rating, reason, comment ? String(comment).slice(0, 1000) : null, session?.email ?? null]
  );
  return rows[0]?.feedback_id ?? null;
}
