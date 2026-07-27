import { getModelConfig, getPrompt } from "./config";
import { getPageRegistry, getPageDomains, getSuggestedQuestions } from "./page-context";
import { scopeForSession } from "./permission";
import { gatherEvidence } from "./retrieval";
import { classifyQuestion, validatePageContext } from "./context-rules";
import { assessConfidence } from "./confidence-rules";
import { validateClaims } from "./source-rules";
import { openRun, recordStep, recordSources, recordClaims, finishRun } from "./runs";
import { selectDomains } from "./domain-select";
import { generateGoverned } from "../llm";

/*
 * The shared Finance Intelligence orchestrator (CR §5, §6). Both Finance Buddy
 * and AI Perspective run through here so there is ONE governed path:
 *   resolve permissions → build page/filter context → classify → select domains
 *   → retrieve governed facts (existing services) → assess freshness/confidence
 *   → [model interprets] → validate claims vs sources → respond (+ audit run).
 *
 * The model never computes governed figures; it only interprets the facts the
 * retrieval layer supplies. Phase 1 ships the foundation — `buildEvidencePack`
 * is the deterministic, testable core, and `runPerspective` is ready for the
 * Phase 3 UI to call.
 */

// Deterministic — resolve everything needed for a request WITHOUT a model call.
export async function assembleContext({ session, pageId = null, filters = {}, question = "" }) {
  const scope = scopeForSession(session);
  const questionType = classifyQuestion(question);

  let registry = null;
  let domains = { primary: [], related: [] };
  if (pageId) {
    registry = await getPageRegistry(pageId);
    domains = await getPageDomains(pageId);
  }

  const pc = validatePageContext({ pageId: pageId || "buddy", route: registry?.route, filters });
  return {
    scope,
    questionType,
    registry,
    domains,
    filters: pc.ok ? pc.context.filters : {},
    pageId,
  };
}

// Deterministic evidence pack: retrieve governed facts for the page's primary +
// related domains and assess confidence. No model call — this is unit-testable
// and is what Phase 1 delivers as the foundation.
export async function buildEvidencePack(ctx) {
  const domains = [...(ctx.domains.primary || []), ...(ctx.domains.related || [])];
  const evidence = await gatherEvidence(domains, ctx.scope);
  const confidence = assessConfidence(evidence.sources, {
    nowMs: Date.now(),
    hasUnapprovedForecast: !!evidence.flags?.hasUnapprovedForecast,
    incompletePeriod: !!evidence.flags?.incompletePeriod,
  });
  return { ...evidence, confidence };
}

// Build the user-message payload handed to the model: the governed facts, the
// page/filter context and the question — kept separate from the system prompt.
function buildUserMessage({ ctx, evidence, question }) {
  const lines = [];
  lines.push(`Page: ${ctx.registry?.page_name || ctx.pageId || "Finance Buddy"}`);
  if (ctx.filters && Object.keys(ctx.filters).length) lines.push(`Filters: ${JSON.stringify(ctx.filters)}`);
  lines.push(`Question type: ${ctx.questionType}`);
  lines.push("");
  lines.push("GOVERNED FACTS (use only these figures — do not invent any number):");
  if (evidence.facts.length) {
    for (const f of evidence.facts) {
      const v = f.unit === "%" ? `${f.value}%` : f.unit === "count" ? `${f.value}` : `£${Number(f.value).toLocaleString("en-GB")}`;
      lines.push(`- ${f.label}: ${v}`);
    }
  } else {
    lines.push("- (no governed figures available for this scope/page)");
  }
  if (evidence.warnings?.length) {
    lines.push("");
    lines.push("DATA LIMITATIONS:");
    for (const w of evidence.warnings) lines.push(`- ${w}`);
  }
  if (question) {
    lines.push("");
    lines.push(`QUESTION: ${question}`);
  }
  return lines.join("\n");
}

/*
 * AI Perspective (structured). Wired and ready for the Phase 3 UI/endpoint.
 * Returns { ok, perspective|null, sources, confidence, runId, refusal, warnings }.
 */
export async function runPerspective({ session, pageId, filters = {}, question = "" }) {
  const cfg = await getModelConfig("PERSPECTIVE");
  const prompt = cfg?.prompt_code ? await getPrompt(cfg.prompt_code) : null;
  const ctx = await assembleContext({ session, pageId, filters, question });

  const runId = await openRun({
    surface: "PERSPECTIVE", session, pageId, questionType: ctx.questionType,
    question, filters, model: cfg?.model, promptCode: cfg?.prompt_code, scopeNote: ctx.scope.note,
  });

  try {
    await recordStep(runId, 1, "Resolve permissions & page context", `scope: ${ctx.scope.unrestricted ? "full" : "withheld"}`);
    const evidence = await buildEvidencePack(ctx);
    await recordStep(runId, 2, "Retrieve governed facts", `${evidence.facts.length} facts, ${evidence.sources.length} sources`);
    await recordSources(runId, evidence.sources);

    if (!cfg || !prompt) {
      await finishRun(runId, { status: "FAILED", error: "Model/prompt not configured" }, session);
      return { ok: false, error: "Intelligence layer is not configured (run migration 038).", runId };
    }

    const user = buildUserMessage({ ctx, evidence, question });
    const out = await generateGoverned({ system: prompt.system_prompt, user, model: cfg.model, maxTokens: cfg.max_tokens, schema: prompt.output_schema });
    await recordStep(runId, 3, "Generate perspective", out.refusal ? "refusal" : "ok");

    if (out.refusal) {
      await finishRun(runId, { status: "REFUSED", confidence: evidence.confidence.level, usage: out.usage }, session);
      return { ok: false, refusal: true, sources: evidence.sources, confidence: evidence.confidence, runId };
    }

    // Structural claim check (backstop on top of "use only supplied figures").
    const perspective = out.json;
    const claimStrings = perspective ? [...(perspective.facts || []), ...(perspective.financial_effects || [])] : [];
    const claims = claimStrings.map((s) => ({ value: (String(s).match(/-?£?[\d,.]+/) || [null])[0] }));
    const claimCheck = validateClaims(claims, evidence.factValues);
    await recordStep(runId, 4, "Validate claims vs sources", claimCheck.ok ? "all verified" : `${claimCheck.unverified.length} unverified`);

    await finishRun(runId, {
      status: "SUCCESS",
      confidence: evidence.confidence.level,
      summary: perspective?.executive_summary || null,
      usage: out.usage,
    }, session);

    return {
      ok: true,
      perspective,
      sources: evidence.sources,
      confidence: evidence.confidence,
      claimsVerified: claimCheck.ok,
      warnings: evidence.warnings,
      runId,
    };
  } catch (e) {
    await finishRun(runId, { status: "FAILED", error: e.message }, session);
    return { ok: false, error: e.message, runId };
  }
}

/*
 * Finance Buddy (conversational). The open-ended surface: no page anchors it, so
 * it selects governed domains from the question itself (domain-select.js), then
 * runs the SAME governed path as Perspective — resolve permissions, retrieve only
 * the governed facts the existing services produce, assess confidence, let the
 * model interpret (never compute), and record an auditable run. Prior turns are
 * passed as conversation memory; the model still has no tools and can take no
 * action. Returns { ok, answer, sources, confidence, questionType, refusal,
 * warnings, runId }.
 */
export async function runBuddy({ session, question, history = [], conversationId = null }) {
  const cfg = await getModelConfig("BUDDY");
  const prompt = cfg?.prompt_code ? await getPrompt(cfg.prompt_code) : null;

  // Buddy has no page — build context, then pick domains from the question.
  const ctx = await assembleContext({ session, pageId: null, filters: {}, question });
  ctx.domains = selectDomains(question);

  const runId = await openRun({
    surface: "BUDDY", session, questionType: ctx.questionType,
    question, model: cfg?.model, promptCode: cfg?.prompt_code, scopeNote: ctx.scope.note, conversationId,
  });

  try {
    await recordStep(runId, 1, "Resolve permissions & select domains",
      `scope: ${ctx.scope.unrestricted ? "full" : "withheld"}; domains: ${[...ctx.domains.primary, ...ctx.domains.related].join(", ") || "none"}`);
    const evidence = await buildEvidencePack(ctx);
    await recordStep(runId, 2, "Retrieve governed facts", `${evidence.facts.length} facts, ${evidence.sources.length} sources`);
    await recordSources(runId, evidence.sources);

    if (!cfg || !prompt) {
      await finishRun(runId, { status: "FAILED", error: "Model/prompt not configured" }, session);
      return { ok: false, error: "Finance Buddy is not configured yet (run migration 038).", runId };
    }

    const user = buildUserMessage({ ctx, evidence, question });
    // Conversation memory: prior turns then the current governed turn.
    const priorMessages = (history || [])
      .filter((m) => m && m.role && m.content)
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }))
      .slice(-8);
    const messages = [...priorMessages, { role: "user", content: user }];

    const out = await generateGoverned({ system: prompt.system_prompt, messages, model: cfg.model, maxTokens: cfg.max_tokens });
    await recordStep(runId, 3, "Generate answer", out.refusal ? "refusal" : "ok");

    const cited = shapeSources(evidence.sources);

    if (out.refusal) {
      await finishRun(runId, { status: "REFUSED", confidence: evidence.confidence.level, usage: out.usage }, session);
      return { ok: true, refusal: true, answer: null, sources: cited, confidence: evidence.confidence, questionType: ctx.questionType, warnings: evidence.warnings, runId };
    }

    await finishRun(runId, {
      status: "SUCCESS",
      confidence: evidence.confidence.level,
      summary: (out.text || "").slice(0, 2000),
      usage: out.usage,
    }, session);

    return {
      ok: true,
      answer: out.text,
      sources: cited,
      confidence: evidence.confidence,
      questionType: ctx.questionType,
      warnings: evidence.warnings,
      runId,
    };
  } catch (e) {
    await finishRun(runId, { status: "FAILED", error: e.message }, session);
    return { ok: false, error: e.message, runId };
  }
}

// Trim retrieval source objects to the fields the UI and the message record need.
function shapeSources(sources = []) {
  return sources
    .filter((s) => !s.missing)
    .map((s) => ({
      label: s.label || s.module || "Governed source",
      module: s.module || null,
      period: s.period || null,
      dataThrough: s.dataThrough || null,
      route: s.route || null,
    }));
}

// Suggested questions passthrough for a page (CR §13).
export async function suggestedQuestions(pageId) {
  if (!pageId) return [];
  return getSuggestedQuestions(pageId);
}
