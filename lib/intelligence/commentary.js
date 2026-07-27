import { query } from "../db";
import { audit } from "../governance";
import { scopeForSession } from "./permission";
import { gatherEvidence } from "./retrieval";
import { assessConfidence } from "./confidence-rules";
import { getModelConfig, getPrompt } from "./config";
import { openRun, recordStep, recordSources, finishRun } from "./runs";
import { generateGoverned } from "../llm";
import { COMMENTARY_SUBJECTS, isCommentarySubject, domainsForSubject, deriveCommentaryTitle } from "./commentary-rules";

/*
 * Drafted commentary (Phase 5b). The model drafts governed narrative for a
 * subject (management accounts, cash, trading, board pack) over the same
 * retrieval layer as Buddy/Perspective, then a human approves or rejects it.
 * Every draft is an auditable run; the model interprets governed figures only
 * and takes no action. Board/investor commentary stays a DRAFT until sign-off.
 */

function buildCommentaryUser(subject, evidence, scopeRef) {
  const label = COMMENTARY_SUBJECTS[subject]?.label || subject;
  const lines = [`Draft ${label} commentary${scopeRef ? ` for ${scopeRef}` : ""}.`, "", "GOVERNED FACTS (use only these figures — do not invent any number):"];
  if (evidence.facts.length) {
    for (const f of evidence.facts) {
      const v = f.unit === "%" ? `${f.value}%` : f.unit === "count" ? `${f.value}` : `£${Number(f.value).toLocaleString("en-GB")}`;
      lines.push(`- ${f.label}: ${v}`);
    }
  } else {
    lines.push("- (no governed figures available for this scope)");
  }
  if (evidence.warnings?.length) {
    lines.push("", "DATA LIMITATIONS:");
    for (const w of evidence.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

export async function generateCommentary({ actor, subject, scopeRef = null, now = new Date() } = {}) {
  if (!isCommentarySubject(subject)) return { ok: false, error: `Unknown commentary subject: ${subject}` };
  const scope = scopeForSession(actor);
  const cfg = await getModelConfig("COMMENTARY");
  const prompt = cfg?.prompt_code ? await getPrompt(cfg.prompt_code) : null;
  const title = deriveCommentaryTitle(subject, now);

  const runId = await openRun({
    surface: "COMMENTARY", session: actor, questionType: "REPORTING", question: title,
    model: cfg?.model, promptCode: cfg?.prompt_code, scopeNote: scope.note,
  });

  try {
    await recordStep(runId, 1, "Resolve permissions & domains", `${subject}; scope: ${scope.unrestricted ? "full" : "withheld"}`);
    const evidence = await gatherEvidence(domainsForSubject(subject), scope);
    const confidence = assessConfidence(evidence.sources, {
      nowMs: now.getTime(),
      hasUnapprovedForecast: !!evidence.flags?.hasUnapprovedForecast,
      incompletePeriod: !!evidence.flags?.incompletePeriod,
    });
    await recordStep(runId, 2, "Retrieve governed facts", `${evidence.facts.length} facts, ${evidence.sources.length} sources`);
    await recordSources(runId, evidence.sources);

    if (!cfg || !prompt) {
      await finishRun(runId, { status: "FAILED", error: "Commentary not configured" }, actor);
      return { ok: false, error: "Commentary is not configured (run migration 042).", runId };
    }

    const out = await generateGoverned({ system: prompt.system_prompt, user: buildCommentaryUser(subject, evidence, scopeRef), model: cfg.model, maxTokens: cfg.max_tokens, schema: prompt.output_schema });
    await recordStep(runId, 3, "Draft commentary", out.refusal ? "refusal" : "ok");

    if (out.refusal || !out.json) {
      await finishRun(runId, { status: out.refusal ? "REFUSED" : "FAILED", confidence: confidence.level, usage: out.usage, error: out.refusal ? null : "No structured output" }, actor);
      return { ok: false, refusal: !!out.refusal, runId };
    }

    const draft = out.json;
    const cited = (evidence.sources || [])
      .filter((s) => !s.missing)
      .map((s) => ({ label: s.label || s.module || "Governed source", period: s.period || null, dataThrough: s.dataThrough || null, route: s.route || null }));

    await finishRun(runId, { status: "SUCCESS", confidence: confidence.level, summary: draft.title || title, usage: out.usage }, actor);

    const { rows } = await query(
      `INSERT INTO intelligence.commentary (subject, scope_ref, title, draft, confidence, status, run_id, sources, created_by)
       VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8) RETURNING commentary_id`,
      [subject, scopeRef, draft.title || title, JSON.stringify(draft), confidence.level, runId, JSON.stringify(cited), actor?.email || "commentary"]
    );
    const commentaryId = rows[0].commentary_id;
    await audit({ actor, eventType: "commentary.draft", objectType: "commentary", objectRef: String(commentaryId), detail: { subject, runId } });
    return { ok: true, commentaryId, runId, confidence: confidence.level };
  } catch (e) {
    await finishRun(runId, { status: "FAILED", error: e.message }, actor);
    return { ok: false, error: e.message, runId };
  }
}

// Sign-off. decision is APPROVED | REJECTED. Only a DRAFT can be decided.
export async function reviewCommentary(commentaryId, decision, note, actor) {
  const status = decision === "APPROVED" ? "APPROVED" : "REJECTED";
  const { rows } = await query(
    `UPDATE intelligence.commentary
       SET status = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, review_note = $4
     WHERE commentary_id = $1 AND status = 'DRAFT'
     RETURNING commentary_id`,
    [commentaryId, status, actor.email, note || null]
  );
  if (!rows.length) return { ok: false, error: "Not found or already decided" };
  await audit({ actor, eventType: "commentary.review", objectType: "commentary", objectRef: String(commentaryId), detail: { decision: status } });
  return { ok: true, status };
}

export async function listCommentary(limit = 30) {
  const { rows } = await query(
    `SELECT commentary_id, subject, scope_ref, title, confidence, status, reviewed_by, created_at
     FROM intelligence.commentary ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getCommentary(id) {
  const { rows } = await query(`SELECT * FROM intelligence.commentary WHERE commentary_id = $1`, [id]);
  return rows[0] || null;
}
