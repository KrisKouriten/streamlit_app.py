import { query } from "../db";
import { scopeForSession } from "./permission";
import { gatherEvidence } from "./retrieval";
import { assessConfidence } from "./confidence-rules";
import { getModelConfig, getPrompt } from "./config";
import { openRun, recordStep, recordSources, finishRun } from "./runs";
import { generateGoverned } from "../llm";
import { listUsersWithRoles } from "../governance";
import { notifyUser } from "../notifications";
import { BRIEFING_DOMAINS, deriveBriefingTitle } from "./briefing-rules";

/*
 * Proactive briefings (Phase 5). A scheduled, governed brief over the same
 * retrieval layer Buddy and Perspective use: resolve permissions → retrieve only
 * the governed facts the existing services produce → assess confidence → the
 * model interprets (never computes) → record an auditable run → persist the
 * brief → notify finance/admin/exec users in their Inbox.
 *
 * The model takes no action. The brief is a governed read for humans; anything
 * Board/investor-facing remains a draft for human sign-off.
 */

const RECIPIENT_ROLES = ["ADMIN", "FINANCE", "EXEC"];

function buildBriefingUser(evidence) {
  const lines = ["GOVERNED FACTS (use only these figures — do not invent any number):"];
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
  lines.push("", "Write today's proactive finance brief from these facts.");
  return lines.join("\n");
}

/*
 * Generate one briefing. `actor` supplies the permission scope (a system actor
 * with a finance grant for the cron; a signed-in admin for a manual kick) and is
 * recorded as the run/audit actor. Returns { ok, briefingId, runId, confidence,
 * notified } or { ok:false, ... }.
 */
export async function generateBriefing({ actor, kind = "EXEC", now = new Date() } = {}) {
  const scope = scopeForSession(actor);
  const cfg = await getModelConfig("BRIEFING");
  const prompt = cfg?.prompt_code ? await getPrompt(cfg.prompt_code) : null;
  const title = deriveBriefingTitle(kind, now);

  const runId = await openRun({
    surface: "BRIEFING", session: actor, questionType: "REPORTING", question: title,
    model: cfg?.model, promptCode: cfg?.prompt_code, scopeNote: scope.note,
  });

  try {
    await recordStep(runId, 1, "Resolve permissions & domains", `scope: ${scope.unrestricted ? "full" : "withheld"}`);
    const evidence = await gatherEvidence(BRIEFING_DOMAINS, scope);
    const confidence = assessConfidence(evidence.sources, {
      nowMs: now.getTime(),
      hasUnapprovedForecast: !!evidence.flags?.hasUnapprovedForecast,
      incompletePeriod: !!evidence.flags?.incompletePeriod,
    });
    await recordStep(runId, 2, "Retrieve governed facts", `${evidence.facts.length} facts, ${evidence.sources.length} sources`);
    await recordSources(runId, evidence.sources);

    if (!cfg || !prompt) {
      await finishRun(runId, { status: "FAILED", error: "Briefing not configured" }, actor);
      return { ok: false, error: "Briefing is not configured (run migration 041).", runId };
    }

    const out = await generateGoverned({ system: prompt.system_prompt, user: buildBriefingUser(evidence), model: cfg.model, maxTokens: cfg.max_tokens, schema: prompt.output_schema });
    await recordStep(runId, 3, "Generate briefing", out.refusal ? "refusal" : "ok");

    if (out.refusal || !out.json) {
      await finishRun(runId, { status: out.refusal ? "REFUSED" : "FAILED", confidence: confidence.level, usage: out.usage, error: out.refusal ? null : "No structured output" }, actor);
      return { ok: false, refusal: !!out.refusal, runId };
    }

    const brief = out.json;
    const cited = (evidence.sources || [])
      .filter((s) => !s.missing)
      .map((s) => ({ label: s.label || s.module || "Governed source", period: s.period || null, dataThrough: s.dataThrough || null, route: s.route || null }));

    await finishRun(runId, { status: "SUCCESS", confidence: confidence.level, summary: brief.headline || title, usage: out.usage }, actor);

    const { rows } = await query(
      `INSERT INTO intelligence.briefing (kind, title, headline, summary, body, confidence, run_id, sources, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING briefing_id`,
      [kind, title, brief.headline || null, brief.summary || null, JSON.stringify(brief), confidence.level, runId, JSON.stringify(cited), actor?.email || "briefing-cron"]
    );
    const briefingId = rows[0].briefing_id;

    // Surface to finance/admin/exec users' Inbox (best-effort — a notify failure
    // must never fail the brief).
    let notified = 0;
    try {
      const users = await listUsersWithRoles();
      for (const u of users) {
        if (!u.is_active || !u.roles?.some((r) => RECIPIENT_ROLES.includes(r))) continue;
        await notifyUser({
          userId: u.id, kind: "briefing",
          title: `Finance brief: ${(brief.headline || title).slice(0, 140)}`,
          body: brief.summary ? String(brief.summary).slice(0, 300) : null,
          link: `/finance-os/briefings?b=${briefingId}`,
          actor: "Finance Intelligence", objectType: "briefing", objectRef: String(briefingId),
        });
        notified++;
      }
    } catch (e) {
      console.error("BRIEFING NOTIFY FAILED", e.message);
    }

    return { ok: true, briefingId, runId, confidence: confidence.level, notified };
  } catch (e) {
    await finishRun(runId, { status: "FAILED", error: e.message }, actor);
    return { ok: false, error: e.message, runId };
  }
}

export async function listBriefings(limit = 20) {
  const { rows } = await query(
    `SELECT briefing_id, kind, title, headline, summary, confidence, sources, created_at
     FROM intelligence.briefing ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getBriefing(id) {
  const { rows } = await query(`SELECT * FROM intelligence.briefing WHERE briefing_id = $1`, [id]);
  return rows[0] || null;
}
